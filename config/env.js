const logger = require('../utils/logger');

const requiredEnvVars = [
    'COGNITO_USER_POOL_ID',
    'COGNITO_CLIENT_ID',
    'COGNITO_USER_POOL_ID_ADMIN',
    'COGNITO_CLIENT_ID_ADMIN'
];

const validateEnv = () => {
    const missing = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missing.length > 0) {
        logger.error('Variáveis de ambiente obrigatórias não encontradas', null, {
            missing: missing
        });
        throw new Error(`Variáveis de ambiente obrigatórias não encontradas: ${missing.join(', ')}`);
    }
    
    logger.info('Todas as variáveis de ambiente obrigatórias estão configuradas');
};

module.exports = { validateEnv };

