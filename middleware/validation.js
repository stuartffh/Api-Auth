const logger = require('../utils/logger');

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const otpRegex = /^\d{6}$/;

const validateAuthInput = (req, res, next) => {
    const { email, password, otp } = req.body;
    const errors = [];

    // Validação de email
    if (!email || typeof email !== 'string' || email.trim().length === 0) {
        errors.push('Email é obrigatório');
    } else if (!emailRegex.test(email.trim())) {
        errors.push('Email inválido');
    }

    // Validação de password
    if (!password || typeof password !== 'string' || password.length === 0) {
        errors.push('Senha é obrigatória');
    } else if (password.length < 6) {
        errors.push('Senha deve ter no mínimo 6 caracteres');
    }

    // Validação de OTP (opcional, mas se fornecido deve ser válido)
    if (otp !== undefined && otp !== null) {
        if (typeof otp !== 'string' && typeof otp !== 'number') {
            errors.push('OTP deve ser uma string ou número');
        } else if (!otpRegex.test(String(otp))) {
            errors.push('OTP deve conter exatamente 6 dígitos numéricos');
        }
    }

    if (errors.length > 0) {
        logger.warn('Validação de entrada falhou', {
            errors,
            email: email ? logger.maskEmail(email) : 'não fornecido',
            ip: req.ip || req.headers['x-forwarded-for'] || 'unknown'
        });
        return res.status(400).json({
            success: false,
            error: 'Dados de entrada inválidos',
            details: errors
        });
    }

    // Sanitiza os dados
    req.body.email = email.trim().toLowerCase();
    req.body.password = password;
    if (otp !== undefined && otp !== null) {
        req.body.otp = String(otp);
    }

    next();
};

module.exports = { validateAuthInput };

