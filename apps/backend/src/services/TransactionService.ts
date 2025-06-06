import { injectable, inject, container } from 'tsyringe';
import mongoose from 'mongoose';
import { ITransactionService } from '../interfaces/services/ITransactionService';
import { ITransactionRepository } from '../interfaces/repositories/ITransactionRepository';
import { IAccountRepository } from '../interfaces/repositories/IAccountRepository';
import { 
  ITransactionCreateDTO,
  ITransactionUpdateDTO,
  ITransactionFilters,
  ITransactionPopulated,
  ITransactionListResult,
  ITransactionStats
} from '../interfaces/entities/ITransaction';
import { ApiError } from '../utils/ApiError';
import { TransactionManager } from '../utils/TransactionManager';
import { ICreditCardRepository } from '../interfaces/repositories/ICreditCardRepository';
import { IInvestmentRepository } from '../interfaces/repositories/IInvestmentRepository';

@injectable()
export class TransactionService implements ITransactionService {
  constructor(
    @inject('TransactionRepository')
    private transactionRepository: ITransactionRepository,
    @inject('AccountRepository')
    private accountRepository: IAccountRepository
  ) {}

  async createTransaction(userId: string, transactionData: ITransactionCreateDTO): Promise<ITransactionPopulated> {
    return TransactionManager.executeInTransaction(async (session) => {
      // Convertendo objetos de string para Date quando necessário
      const processedData: any = { ...transactionData };
      if (typeof processedData.date === 'string') {
        processedData.date = new Date(processedData.date);
      }
      
      // Convertendo strings para ObjectId
      const newTransaction = {
        ...processedData,
        user: new mongoose.Types.ObjectId(userId),
        account: new mongoose.Types.ObjectId(processedData.account),
        category: new mongoose.Types.ObjectId(processedData.category),
        creditCard: processedData.creditCard ? new mongoose.Types.ObjectId(processedData.creditCard) : undefined,
        investment: processedData.investment ? new mongoose.Types.ObjectId(processedData.investment) : undefined // Incluir referência ao investimento
      };
      
      // Criar a transação
      const transaction = await this.transactionRepository.create(newTransaction, { session });
      
      // Se for transação com cartão de crédito
      if (processedData.creditCard && processedData.type === 'expense') {
        const creditCardRepository = container.resolve<ICreditCardRepository>('CreditCardRepository');
        
        // Atualizar o saldo do cartão
        await creditCardRepository.updateBalance(
          processedData.creditCard,
          userId,
          processedData.amount,
          { session }
        );
      } else if (processedData.investment && processedData.type === 'investment') {
        // Se for transação de investimento, atualizar o investimento
        const investmentRepository = container.resolve<IInvestmentRepository>('InvestmentRepository');
        
        // Buscar o investimento para obter valor atual
        const investment = await investmentRepository.findById(processedData.investment, userId);
        
        if (investment) {
          // Atualizar valores do investimento
          const currentValue = investment.currentValue + processedData.amount;
          
          // Calcular novos valores de performance
          const performance = {
            absoluteReturn: currentValue - investment.initialValue,
            percentageReturn: investment.initialValue > 0 
              ? ((currentValue - investment.initialValue) / investment.initialValue) * 100 
              : 0
          };
          
          // Atualizar o investimento
          await investmentRepository.update(
            processedData.investment,
            userId,
            { 
              currentValue,
              performance
            },
            { session }
          );
        }
      } else {
        // Atualizar o saldo da conta normal
        const account = await this.accountRepository.findById(processedData.account, userId) as { _id: mongoose.Types.ObjectId; balance: number } | null;
        
        if (!account) {
          throw new ApiError('Conta não encontrada', 404);
        }
        
        const amount = processedData.amount || 0;
        
        if (processedData.type === 'income') {
          account.balance += amount;
        } else if (processedData.type === 'expense') {
          account.balance -= amount;
        } else if (processedData.type === 'investment') {
          // Transações de investimento também são consideradas saídas da conta
          account.balance -= amount;
        }
        
        await this.accountRepository.update(
          account._id.toString(), 
          userId, 
          { balance: account.balance }, 
          { session }
        );
      }
      
      return transaction;
    });
  }
  
  async getUserTransactions(userId: string, filters: ITransactionFilters): Promise<ITransactionListResult> {
    // Processar datas nos filtros
    const processedFilters = { ...filters };
    
    const transactions = await this.transactionRepository.findByUser(userId, processedFilters);
    const total = await this.transactionRepository.countByUser(userId, processedFilters);
    
    const page = processedFilters.page || 1;
    const limit = processedFilters.limit || 10;
    
    return {
      transactions,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }
  
  async getTransactionById(transactionId: string, userId: string): Promise<ITransactionPopulated> {
    const transaction = await this.transactionRepository.findById(transactionId, userId);
    
    if (!transaction) {
      throw new ApiError('Transação não encontrada', 404);
    }
    
    return transaction;
  }
  
  async updateTransaction(transactionId: string, userId: string, updateData: ITransactionUpdateDTO): Promise<ITransactionPopulated> {
    return TransactionManager.executeInTransaction(async (session) => {
      // Processar data se for string
      const processedUpdateData: any = { ...updateData };
      if (typeof updateData.date === 'string') {
        processedUpdateData.date = new Date(updateData.date);
      }
      
      // Converter IDs para ObjectId
      if (processedUpdateData.account) {
        processedUpdateData.account = new mongoose.Types.ObjectId(processedUpdateData.account);
      }
      
      if (processedUpdateData.category) {
        processedUpdateData.category = new mongoose.Types.ObjectId(processedUpdateData.category);
      }
      
      if (processedUpdateData.investment) {
        processedUpdateData.investment = new mongoose.Types.ObjectId(processedUpdateData.investment);
      }
      
      // Obter a transação original
      const originalTransaction = await this.transactionRepository.findById(transactionId, userId);
      
      if (!originalTransaction) {
        throw new ApiError('Transação não encontrada', 404);
      }
      
      // Verificar se houve alteração de valor, tipo ou conta que afeta saldos
      const needsAccountUpdate = 
        (updateData.amount !== undefined && updateData.amount !== originalTransaction.amount) ||
        (updateData.type !== undefined && updateData.type !== originalTransaction.type) ||
        (updateData.account !== undefined && updateData.account !== originalTransaction.account._id.toString());
      
      // Verificar se houve alteração no investimento
      const needsInvestmentUpdate = 
        originalTransaction.type === 'investment' &&
        ((updateData.amount !== undefined && updateData.amount !== originalTransaction.amount) ||
         (updateData.investment !== undefined && originalTransaction.investment && 
          updateData.investment !== originalTransaction.investment._id.toString()));
      
      if (needsAccountUpdate) {
        // Reverter o efeito da transação original na conta
        const originalAccount = await this.accountRepository.findById(
          originalTransaction.account._id.toString(),
          userId
        ) as { _id: mongoose.Types.ObjectId, balance: number };
        
        if (!originalAccount) {
          throw new ApiError('Conta original não encontrada', 404);
        }
        
        // Reverter o efeito
        if (originalTransaction.type === 'income') {
          originalAccount.balance -= originalTransaction.amount;
        } else if (originalTransaction.type === 'expense' || originalTransaction.type === 'investment') {
          originalAccount.balance += originalTransaction.amount;
        }
        
        await this.accountRepository.update(
          originalAccount._id.toString(),
          userId,
          { balance: originalAccount.balance },
          { session }
        );
        
        // Aplicar o efeito da nova transação
        let targetAccount = originalAccount;
        
        // Se a conta foi alterada, buscar a nova conta
        if (updateData.account && updateData.account !== originalTransaction.account._id.toString()) {
          const foundAccount = await this.accountRepository.findById(updateData.account, userId);
          if (!foundAccount) {
            throw new ApiError('Conta de destino não encontrada', 404);
          }
          targetAccount = foundAccount as { _id: mongoose.Types.ObjectId; balance: number };
          
          if (!targetAccount) {
            throw new ApiError('Conta de destino não encontrada', 404);
          }
        }
        
        // Aplicar o novo efeito
        const newType = updateData.type || originalTransaction.type;
        const newAmount = updateData.amount !== undefined ? updateData.amount : originalTransaction.amount;
        
        if (newType === 'income') {
          targetAccount.balance += newAmount;
        } else if (newType === 'expense' || newType === 'investment') {
          targetAccount.balance -= newAmount;
        }
        
        await this.accountRepository.update(
          targetAccount._id.toString(),
          userId,
          { balance: targetAccount.balance },
          { session }
        );
      }
      
      // Se for uma transação de investimento e houve alteração no valor ou no investimento
      if (needsInvestmentUpdate) {
        const investmentRepository = container.resolve<IInvestmentRepository>('InvestmentRepository');
        
        // Se havia um investimento associado, reverter o efeito
        if (originalTransaction.investment && originalTransaction.investment._id) {
          const originalInvestment = await investmentRepository.findById(
            originalTransaction.investment._id.toString(),
            userId
          ) as { _id: mongoose.Types.ObjectId; currentValue: number; initialValue: number } | null;
          
          if (originalInvestment) {
            // Reverter o valor da transação
            const updatedCurrentValue = originalInvestment.currentValue - originalTransaction.amount;
            
            // Recalcular performance
            const performance = {
              absoluteReturn: updatedCurrentValue - originalInvestment.initialValue,
              percentageReturn: originalInvestment.initialValue > 0 
                ? ((updatedCurrentValue - originalInvestment.initialValue) / originalInvestment.initialValue) * 100 
                : 0
            };
            
            await investmentRepository.update(
              originalInvestment._id.toString(),
              userId,
              { 
                currentValue: updatedCurrentValue,
                performance
              },
              { session }
            );
          }
        }
        
        // Se há um novo investimento ou o mesmo investimento com valor atualizado
        const newInvestmentId = updateData.investment || 
          (originalTransaction.investment && originalTransaction.investment._id.toString());
          
        if (newInvestmentId) {
          const targetInvestment = await investmentRepository.findById(newInvestmentId, userId) as { _id: mongoose.Types.ObjectId; currentValue: number; initialValue: number } | null;
          
          if (targetInvestment) {
            const newAmount = updateData.amount !== undefined ? updateData.amount : originalTransaction.amount;
            const updatedCurrentValue = targetInvestment.currentValue + newAmount;
            
            // Calcular nova performance
            const performance = {
              absoluteReturn: updatedCurrentValue - targetInvestment.initialValue,
              percentageReturn: targetInvestment.initialValue > 0 
                ? ((updatedCurrentValue - targetInvestment.initialValue) / targetInvestment.initialValue) * 100 
                : 0
            };
            
            await investmentRepository.update(
              targetInvestment._id.toString(),
              userId,
              { 
                currentValue: updatedCurrentValue,
                performance
              },
              { session }
            );
          }
        }
      }
      
      // Atualizar a transação
      const updatedTransaction = await this.transactionRepository.update(
        transactionId,
        userId,
        processedUpdateData,
        { session }
      );
      
      if (!updatedTransaction) {
        throw new ApiError('Falha ao atualizar transação', 500);
      }
      
      return updatedTransaction;
    });
  }
  
  async deleteTransaction(transactionId: string, userId: string): Promise<{ success: boolean }> {
    return TransactionManager.executeInTransaction(async (session) => {
      // Obter a transação
      const transaction = await this.transactionRepository.findById(transactionId, userId);
      
      if (!transaction) {
        throw new ApiError('Transação não encontrada', 404);
      }
      
      // Se for uma transação de investimento, atualizar o investimento
      if (transaction.type === 'investment' && transaction.investment) {
        const investmentRepository = container.resolve<IInvestmentRepository>('InvestmentRepository');
        const investment = await investmentRepository.findById(
          transaction.investment._id.toString(),
          userId
        ) as { _id: mongoose.Types.ObjectId; currentValue: number; initialValue: number } | null;
        
        if (investment) {
          // Reverter o valor da transação
          const updatedCurrentValue = investment.currentValue - transaction.amount;
          
          // Recalcular performance
          const performance = {
            absoluteReturn: updatedCurrentValue - investment.initialValue,
            percentageReturn: investment.initialValue > 0 
              ? ((updatedCurrentValue - investment.initialValue) / investment.initialValue) * 100 
              : 0
          };
          
          await investmentRepository.update(
            investment._id.toString(),
            userId,
            { 
              currentValue: updatedCurrentValue,
              performance
            },
            { session }
          );
        }
      }
      
      // Reverter o efeito da transação na conta
      const account = await this.accountRepository.findById(
        transaction.account._id.toString(),
        userId
      ) as { _id: mongoose.Types.ObjectId; balance: number } | null;
      
      if (!account) {
        throw new ApiError('Conta não encontrada', 404);
      }
      
      if (transaction.type === 'income') {
        account.balance -= transaction.amount;
      } else if (transaction.type === 'expense' || transaction.type === 'investment') {
        account.balance += transaction.amount;
      }
      
      await this.accountRepository.update(
        account?._id.toString() || '',
        userId,
        { balance: account.balance },
        { session }
      );
      
      // Excluir a transação
      const deleted = await this.transactionRepository.delete(transactionId, userId, { session });
      
      return { success: deleted };
    });
  }
  
  async getTransactionStats(userId: string, period: 'day' | 'week' | 'month' | 'year' = 'month'): Promise<ITransactionStats> {
    // Calcular intervalo de datas com base no período
    const now = new Date();
    let startDate = new Date();
    
    switch (period) {
      case 'day':
        startDate.setDate(now.getDate() - 1);
        break;
      case 'week':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(now.getMonth() - 1);
        break;
      case 'year':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
    }
    
    // Obter transações no intervalo de datas
    const transactions = await this.transactionRepository.findByDateRange(userId, startDate, now);

    // Calcular receitas, despesas e investimentos
    let totalIncome = 0;
    let totalExpenses = 0;
    let totalInvestment = 0;
    let incomeByCategory: Record<string, number> = {};
    let expensesByCategory: Record<string, number> = {};
    let investmentsByType: Record<string, number> = {};
    
    transactions.forEach((transaction) => {
      if (transaction.type === 'income') {
        totalIncome += transaction.amount;
        
        const categoryName = transaction.category ? transaction.category.name : 'Sem categoria';
        
        if (!incomeByCategory[categoryName]) {
          incomeByCategory[categoryName] = 0;
        }
        
        incomeByCategory[categoryName] += transaction.amount;
      } else if (transaction.type === 'expense') {
        totalExpenses += transaction.amount;
        
        const categoryName = transaction.category ? transaction.category.name : 'Sem categoria';
        
        if (!expensesByCategory[categoryName]) {
          expensesByCategory[categoryName] = 0;
        }
        
        expensesByCategory[categoryName] += transaction.amount;
      } else if (transaction.type === 'investment') {
        totalInvestment += transaction.amount;
        
        // Usar o tipo do investimento se disponível, senão usar a categoria
        const typeName = transaction.investment ? transaction.investment.type : 
                         transaction.category ? transaction.category.name : 'Outros';
        
        if (!investmentsByType[typeName]) {
          investmentsByType[typeName] = 0;
        }
        
        investmentsByType[typeName] += transaction.amount;
      }
    });
    
    // Calcular saldo
    const balance = totalIncome - totalExpenses - totalInvestment;
    
    // Dados para gráfico por dia
    const transactionsByDay: Record<string, { income: number; expense: number; investment: number }> = {};
    
    // Inicializar dias
    const dayCount = Math.ceil((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    for (let i = 0; i <= dayCount; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dateKey = date.toISOString().split('T')[0];
      if (dateKey) {
        transactionsByDay[dateKey] = { income: 0, expense: 0, investment: 0 };
      }
    }
    
    // Preencher dados
    for (const transaction of transactions) {
      try {
        // Verificar se a data é válida
        if (!(transaction.date instanceof Date)) {
          continue;
        }
        
        const dateKey = transaction.date.toISOString().split('T')[0];
        
        if (dateKey && transactionsByDay[dateKey]) {
          if (transaction.type === 'income') {
            transactionsByDay[dateKey].income += transaction.amount;
          } else if (transaction.type === 'expense') {
            transactionsByDay[dateKey].expense += transaction.amount;
          } else if (transaction.type === 'investment') {
            transactionsByDay[dateKey].investment += transaction.amount;
          }
        }
      } catch (error) {
        console.error('Erro ao processar transação:', error);
        continue;
      }
    }
    
    // Converter para array para dados do gráfico
    const chartData = Object.entries(transactionsByDay).map(([date, data]) => ({
      date,
      income: data.income,
      expense: data.expense,
      investment: data.investment
    })).sort((a, b) => a.date.localeCompare(b.date));
    
    // Categorias com mais despesas
    const topExpenseCategories = Object.entries(expensesByCategory)
      .map(([category, amount]) => ({
        category,
        amount,
        percentage: totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
    
    // Categorias com mais receitas
    const topIncomeCategories = Object.entries(incomeByCategory)
      .map(([category, amount]) => ({
        category,
        amount,
        percentage: totalIncome > 0 ? (amount / totalIncome) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
    
    // Tipos de investimentos
    const topInvestmentTypes = Object.entries(investmentsByType)
      .map(([type, amount]) => ({
        type,
        amount,
        percentage: totalInvestment > 0 ? (amount / totalInvestment) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);
    
    return {
      overview: {
        totalIncome,
        totalExpenses,
        totalInvestment,
        balance,
        period,
      },
      expensesByCategory: topExpenseCategories,
      incomeByCategory: topIncomeCategories,
      investmentsByType: topInvestmentTypes.map(({ type, amount, percentage }) => ({
        category: type,
        amount,
        percentage,
      })),
      chartData,
    };
  }

  async removeAttachment(transactionId: string, userId: string, attachmentId: string): Promise<ITransactionPopulated> {
    return TransactionManager.executeInTransaction(async (session) => {
      // Buscar a transação
      const transaction = await this.transactionRepository.findById(transactionId, userId);
      
      if (!transaction) {
        throw new ApiError('Transação não encontrada', 404);
      }
      
      // Verificar se o anexo existe
      if (!transaction.attachments || transaction.attachments.length === 0) {
        throw new ApiError('Transação não possui anexos', 404);
      }
      
      // Filtrar o anexo pelo _id
      // Precisamos fazer uma verificação do tipo para garantir que o TypeScript entenda que _id existe
      const updatedAttachments = transaction.attachments.filter((attachment: any) => {
        const attachmentIdStr = attachment._id ? attachment._id.toString() : '';
        return attachmentIdStr !== attachmentId;
      });
      
      // Se não houve alteração, significa que o anexo não foi encontrado
      if (updatedAttachments.length === transaction.attachments.length) {
        throw new ApiError('Anexo não encontrado', 404);
      }
      
      // Atualizar a transação
      const updatedTransaction = await this.transactionRepository.update(
        transactionId,
        userId,
        { attachments: updatedAttachments },
        { session }
      );
      
      if (!updatedTransaction) {
        throw new ApiError('Falha ao remover anexo', 500);
      }
      
      return updatedTransaction;
    });
  }
  
  async getTransactionsByInvestment(userId: string, investmentId: string): Promise<ITransactionPopulated[]> {
    const transactions = await this.transactionRepository.findByInvestment(userId, investmentId);
    return transactions;
  }
}