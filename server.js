require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const Database = require('./config/database');
const { validateEnv } = require('./config/env');
const createAuthRoutes = require('./routes/authRoutes');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const logger = require('./utils/logger');

// Validação de variáveis de ambiente
try {
    validateEnv();
} catch (error) {
    logger.error('Falha na validação de variáveis de ambiente', error);
    process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Inicialização do banco de dados
let db;
try {
    db = new Database('./auth_logs.db');
} catch (error) {
    logger.error('Falha ao inicializar banco de dados', error);
    process.exit(1);
}

// Rotas
app.use(createAuthRoutes(db));
app.use('/api/azulbi', require('./routes/azulbiRoutes')(db));

// Middleware de tratamento de erros (deve ser o último)
app.use(notFoundHandler);
app.use(errorHandler);

// Inicialização do servidor
const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info('Servidor iniciado', {
        port: PORT,
        environment: process.env.NODE_ENV || 'development'
    });
});

// Graceful shutdown
const gracefulShutdown = async (signal) => {
    logger.info(`Sinal ${signal} recebido. Iniciando graceful shutdown...`);
    
    server.close(async () => {
        logger.info('Servidor HTTP fechado');
        
        try {
            if (db) {
                await db.close();
            }
            logger.info('Graceful shutdown concluído');
            process.exit(0);
        } catch (error) {
            logger.error('Erro durante graceful shutdown', error);
            process.exit(1);
        }
    });

    // Força o fechamento após 10 segundos
    setTimeout(() => {
        logger.error('Graceful shutdown timeout. Forçando saída...');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
    logger.error('Exceção não capturada', error);
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Promise rejeitada não tratada', reason, { promise });
});

module.exports = app;
