const express = require('express');
const { capturarBookmarkState } = require('../services/capturar-bookmarkstate-api');
const logger = require('../utils/logger');

/**
 * Rotas para funcionalidades do Conta Azul BI
 */
function createAzulBIRoutes(db) {
    const router = express.Router();

    /**
     * POST /api/azulbi/capturar-bookmarkstate
     * 
     * Captura o bookmarkState para uma empresa específica
     * 
     * Body:
     * {
     *   "tenantId": 3267030,
     *   "reportId": "91d65d35-4cb2-428c-8c11-d4a00ae31fc9" (opcional),
     *   "email": "usuario@exemplo.com" (opcional, para buscar token do banco),
     *   "accountancyToken": "token-aqui" (opcional, se não fornecido, busca do banco usando email)
     * }
     */
    router.post('/capturar-bookmarkstate', async (req, res) => {
        try {
            const { tenantId, reportId, email, accountancyToken } = req.body;

            // Validações
            if (!tenantId) {
                return res.status(400).json({
                    success: false,
                    error: 'tenantId é obrigatório'
                });
            }

            // Buscar accountancyToken do banco se não fornecido
            let token = accountancyToken;
            if (!token) {
                if (!email) {
                    return res.status(400).json({
                        success: false,
                        error: 'accountancyToken ou email é obrigatório. Forneça accountancyToken no body ou email para buscar do banco de dados.'
                    });
                }

                try {
                    const tokens = await db.getTokens(email);
                    if (tokens && tokens.accountancyToken) {
                        token = tokens.accountancyToken;
                        logger.info('accountancyToken obtido do banco de dados', { 
                            email: logger.maskEmail(email),
                            tenantId 
                        });
                    } else {
                        return res.status(400).json({
                            success: false,
                            error: 'accountancyToken não encontrado no banco de dados. Faça login primeiro em /admin/auth para gerar o token.'
                        });
                    }
                } catch (dbError) {
                    logger.error('Erro ao buscar accountancyToken do banco', dbError);
                    return res.status(500).json({
                        success: false,
                        error: 'Erro ao buscar accountancyToken do banco de dados'
                    });
                }
            }

            logger.info('Iniciando captura de bookmarkState', { 
                tenantId, 
                reportId: reportId || 'padrão',
                email: email ? logger.maskEmail(email) : 'não fornecido'
            });

            // Sempre usar headless (navegador não será aberto)
            const shouldBeHeadless = true;
            
            // Capturar bookmarkState
            const bookmarkState = await capturarBookmarkState(
                token,
                tenantId,
                reportId,
                { headless: shouldBeHeadless }
            );

            if (!bookmarkState) {
                return res.status(404).json({
                    success: false,
                    error: 'Não foi possível capturar o bookmarkState. O dashboard pode não ter carregado completamente ou houve um erro durante a captura.'
                });
            }

            logger.info('bookmarkState capturado com sucesso', { 
                tenantId, 
                tamanho: bookmarkState.length 
            });

            res.json({
                success: true,
                data: {
                    tenantId: tenantId,
                    reportId: reportId || '91d65d35-4cb2-428c-8c11-d4a00ae31fc9',
                    bookmarkState: bookmarkState,
                    tamanho: bookmarkState.length,
                    capturedAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Erro ao capturar bookmarkState', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Erro interno ao capturar bookmarkState'
            });
        }
    });

    /**
     * GET /api/azulbi/bookmarkstate/:tenantId
     * 
     * Retorna o bookmarkState salvo para uma empresa (se existir)
     */
    router.get('/bookmarkstate/:tenantId', async (req, res) => {
        try {
            const { tenantId } = req.params;

            // TODO: Buscar do banco de dados
            // const bookmarkState = await db.getBookmarkState(tenantId);

            res.json({
                success: false,
                error: 'Funcionalidade ainda não implementada. Use POST /capturar-bookmarkstate para capturar.'
            });

        } catch (error) {
            logger.error('Erro ao buscar bookmarkState', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Erro interno ao buscar bookmarkState'
            });
        }
    });

    return router;
}

module.exports = createAzulBIRoutes;

