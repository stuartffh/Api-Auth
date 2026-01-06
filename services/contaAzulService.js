const axios = require('axios');
const logger = require('../utils/logger');

class ContaAzulService {
    constructor() {
        this.loginUrl = 'https://accountancy.contaazul.com/rest/accountancy/login';
    }

    /**
     * Obtém o accountancy-token fazendo login no sistema Conta Azul
     * @param {string} email - Email do usuário
     * @param {string} password - Senha do usuário
     * @returns {Promise<string>} - Accountancy token
     */
    async getAccountancyToken(email, password) {
        try {
            logger.info('Obtendo accountancy-token', {
                email: logger.maskEmail(email)
            });

            const formData = new URLSearchParams();
            formData.append('user', email);
            formData.append('password', password);

            const response = await axios.post(
                this.loginUrl,
                formData.toString(),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json',
                        'Origin': 'https://mais.contaazul.com',
                        'Referer': 'https://mais.contaazul.com/'
                    },
                    maxRedirects: 0,
                    validateStatus: (status) => status === 204 || status === 302
                }
            );

            // O token vem no header Authorization ou no cookie
            const authHeader = response.headers['authorization'] || response.headers['Authorization'];
            let token = null;

            if (authHeader) {
                // Remove "Bearer " se presente
                token = authHeader.replace(/^Bearer\s+/i, '').trim();
            } else {
                // Tenta obter do cookie
                const setCookie = response.headers['set-cookie'];
                if (setCookie) {
                    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
                    for (const cookie of cookies) {
                        const match = cookie.match(/auth-token-accountancy=([^;]+)/);
                        if (match) {
                            token = match[1];
                            break;
                        }
                    }
                }
            }

            if (!token) {
                throw new Error('Token não encontrado na resposta do Conta Azul');
            }

            logger.info('Accountancy-token obtido com sucesso', {
                email: logger.maskEmail(email)
            });

            return token;
        } catch (error) {
            logger.error('Erro ao obter accountancy-token', error, {
                email: logger.maskEmail(email),
                status: error.response?.status,
                statusText: error.response?.statusText
            });
            
            // Não falha a autenticação principal se o accountancy-token falhar
            // Apenas loga o erro e retorna null
            return null;
        }
    }
}

module.exports = ContaAzulService;

