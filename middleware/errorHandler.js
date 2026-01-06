const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
    // Erro de validação
    if (err.name === 'ValidationError' || err.status === 400) {
        logger.warn('Erro de validação', err, {
            path: req.path,
            method: req.method,
            ip: req.ip || req.headers['x-forwarded-for'] || 'unknown'
        });
        return res.status(400).json({
            success: false,
            error: err.message || 'Dados inválidos'
        });
    }

    // Erro de autenticação
    if (err.status === 401 || 
        err.name === 'UnauthorizedError' || 
        err.name === 'AuthenticationError' ||
        err.name === 'MFAError' ||
        err.name === 'TOTPRequiredError' ||
        err.name === 'TokenRefreshError') {
        logger.warn('Erro de autenticação', err, {
            path: req.path,
            method: req.method,
            email: req.body?.email ? logger.maskEmail(req.body.email) : 'não fornecido',
            ip: req.ip || req.headers['x-forwarded-for'] || 'unknown'
        });
        return res.status(401).json({
            success: false,
            error: err.message || 'Falha na autenticação'
        });
    }

    // Erro de rate limit
    if (err.status === 429) {
        return res.status(429).json({
            success: false,
            error: err.message || 'Muitas tentativas'
        });
    }

    // Erro interno do servidor
    logger.error('Erro interno do servidor', err, {
        path: req.path,
        method: req.method,
        ip: req.ip || req.headers['x-forwarded-for'] || 'unknown',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });

    res.status(err.status || 500).json({
        success: false,
        error: process.env.NODE_ENV === 'production' 
            ? 'Erro interno do servidor' 
            : err.message
    });
};

const notFoundHandler = (req, res) => {
    logger.warn('Rota não encontrada', null, {
        path: req.path,
        method: req.method,
        ip: req.ip || req.headers['x-forwarded-for'] || 'unknown'
    });
    res.status(404).json({
        success: false,
        error: 'Rota não encontrada'
    });
};

module.exports = { errorHandler, notFoundHandler };

