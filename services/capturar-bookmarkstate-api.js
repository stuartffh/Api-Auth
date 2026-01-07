const puppeteer = require('puppeteer');
const fs = require('fs');

/**
 * Captura o bookmarkState para uma empresa específica
 * 
 * @param {string} accountancyToken - Token de autenticação do Conta Azul
 * @param {number} tenantId - ID da empresa (tenant)
 * @param {string} reportId - ID do relatório (padrão: 91d65d35-4cb2-428c-8c11-d4a00ae31fc9)
 * @param {Object} options - Opções adicionais
 * @returns {Promise<string|null>} - bookmarkState capturado ou null se falhar
 */
async function capturarBookmarkState(accountancyToken, tenantId, reportId = '91d65d35-4cb2-428c-8c11-d4a00ae31fc9', options = {}) {
    const {
        headless = true,
        timeout = 60000,
        waitForDashboard = 30000
    } = options;

    let browser = null;
    let bookmarkState = null;

    try {
        console.log(`🚀 Iniciando captura de bookmarkState para tenantId: ${tenantId}`);

        // Abrir navegador
        browser = await puppeteer.launch({
            headless: headless === true || headless === 'true' ? 'new' : false,
            defaultViewport: null,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        });

        const page = await browser.newPage();

        // Configurar cookies/headers para autenticação
        await page.setExtraHTTPHeaders({
            'accountancy-token': accountancyToken
        });

        // Monitorar requisições para capturar bookmarkState
        page.on('request', request => {
            const url = request.url();
            if (url.includes('/export') && request.method() === 'POST' && request.postData()) {
                try {
                    const body = JSON.parse(request.postData());
                    if (body.bookmarkState) {
                        bookmarkState = body.bookmarkState;
                        console.log('✅ bookmarkState capturado!');
                        console.log(`   Tamanho: ${bookmarkState.length} caracteres`);
                        console.log(`   Preview: ${bookmarkState.substring(0, 50)}...`);
                    }
                } catch (e) {
                    // Ignorar erros de parse
                }
            }
        });

        // Navegar até o dashboard
        const dashboardUrl = `https://mais.contaazul.com/#/dashboard-bi/${tenantId}/customer`;
        console.log(`📊 Navegando até: ${dashboardUrl}`);
        
        await page.goto(dashboardUrl, {
            waitUntil: 'networkidle2',
            timeout: timeout
        });

        // Aguardar o dashboard carregar (iframe do Power BI)
        console.log('⏳ Aguardando dashboard carregar...');
        try {
            await page.waitForSelector('iframe[src*="powerbi"], iframe[src*="wabi"]', {
                timeout: waitForDashboard
            });
            console.log('✅ Dashboard carregado!');
        } catch (e) {
            console.log('⚠️  Timeout aguardando iframe do Power BI. Continuando...');
        }

        // Aguardar um pouco para garantir que tudo carregou
        await page.waitForTimeout(5000);

        // Tentar obter bookmarkState via JavaScript do Power BI
        // Isso só funciona se o Power BI SDK estiver disponível
        try {
            const bookmarkStateFromJS = await page.evaluate(() => {
                // Tentar acessar o Power BI embed
                const iframe = document.querySelector('iframe[src*="powerbi"], iframe[src*="wabi"]');
                if (!iframe) return null;

                // Tentar acessar o objeto do Power BI via iframe
                try {
                    const iframeWindow = iframe.contentWindow;
                    if (iframeWindow && iframeWindow.powerbi) {
                        // Se o Power BI SDK estiver disponível, tentar obter bookmarkState
                        // Isso é complexo e pode não funcionar devido a CORS
                        return null;
                    }
                } catch (e) {
                    // CORS - não podemos acessar o iframe
                }
                return null;
            });

            if (bookmarkStateFromJS) {
                bookmarkState = bookmarkStateFromJS;
                console.log('✅ bookmarkState obtido via JavaScript!');
            }
        } catch (e) {
            console.log('⚠️  Não foi possível obter bookmarkState via JavaScript (normal devido a CORS)');
        }

        // Se ainda não capturamos, tentar simular clique em "Exportar PDF"
        if (!bookmarkState) {
            console.log('📥 Tentando capturar via botão "Exportar PDF"...');
            
            try {
                // Procurar botão de exportar
                const exportButton = await page.$('button:has-text("Exportar PDF"), button[aria-label*="Exportar"], .ds-loader-button__content:has-text("Exportar")');
                
                if (exportButton) {
                    // Clicar no botão
                    await exportButton.click();
                    console.log('✅ Botão "Exportar PDF" clicado!');
                    
                    // Aguardar requisição de exportação
                    await page.waitForTimeout(3000);
                } else {
                    console.log('⚠️  Botão "Exportar PDF" não encontrado');
                }
            } catch (e) {
                console.log('⚠️  Erro ao clicar no botão:', e.message);
            }
        }

        // Se ainda não temos bookmarkState, retornar null
        if (!bookmarkState) {
            console.log('❌ bookmarkState não foi capturado');
            console.log('💡 Dica: O bookmarkState só é gerado quando o usuário interage com o dashboard');
            console.log('💡 Dica: Tente usar o bookmarkState já capturado anteriormente');
        }

    } catch (error) {
        console.error('❌ Erro durante captura:', error.message);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }

    return bookmarkState;
}

/**
 * Função auxiliar para usar com dados do login-capturado.json
 */
async function capturarBookmarkStateFromFile(tenantId) {
    try {
        const loginData = JSON.parse(fs.readFileSync('login-capturado.json', 'utf-8'));
        const accountancyToken = loginData.accountancyToken;

        if (!accountancyToken) {
            throw new Error('accountancyToken não encontrado em login-capturado.json');
        }

        return await capturarBookmarkState(accountancyToken, tenantId);
    } catch (error) {
        console.error('❌ Erro:', error.message);
        throw error;
    }
}

// Se executado diretamente
if (require.main === module) {
    const tenantId = process.argv[2] || '3267030';
    
    capturarBookmarkStateFromFile(tenantId)
        .then(bookmarkState => {
            if (bookmarkState) {
                console.log('\n✅ bookmarkState capturado com sucesso!');
                console.log(`\n📋 bookmarkState:\n${bookmarkState}\n`);
                
                // Salvar em arquivo
                const output = {
                    tenantId: tenantId,
                    bookmarkState: bookmarkState,
                    capturedAt: new Date().toISOString(),
                    tamanho: bookmarkState.length
                };
                
                fs.writeFileSync(`bookmarkstate-${tenantId}.json`, JSON.stringify(output, null, 2));
                console.log(`💾 Salvo em: bookmarkstate-${tenantId}.json`);
            } else {
                console.log('\n❌ Não foi possível capturar o bookmarkState');
                process.exit(1);
            }
        })
        .catch(error => {
            console.error('❌ Erro fatal:', error);
            process.exit(1);
        });
}

module.exports = {
    capturarBookmarkState,
    capturarBookmarkStateFromFile
};

