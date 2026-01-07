const puppeteer = require('puppeteer');
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * Função auxiliar para substituir page.waitForTimeout (removido no Puppeteer moderno)
 * @param {number} ms - Milissegundos para aguardar
 */
function waitForTimeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Tenta limpar processos órfãos do Chrome/Chromium (apenas no Windows)
 * @returns {Promise<void>}
 */
async function limparProcessosOrfaos() {
    if (process.platform !== 'win32') {
        return; // Apenas Windows
    }
    
    try {
        // Tentar matar processos do Chrome que possam estar órfãos
        // Isso é uma tentativa suave - pode não funcionar se não tiver permissões
        await execAsync('taskkill /F /IM chrome.exe /T 2>nul || exit 0');
        await execAsync('taskkill /F /IM chromium.exe /T 2>nul || exit 0');
        await waitForTimeout(1000); // Aguardar processos terminarem
    } catch (e) {
        // Ignorar erros - pode não ter permissão ou não haver processos
    }
}

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
    let page = null;
    let bookmarkState = null;

    // Função auxiliar para verificar se browser/page ainda está conectado
    const isConnected = () => {
        try {
            return browser && browser.isConnected() && page && !page.isClosed();
        } catch (e) {
            return false;
        }
    };

    try {
        console.log(`🚀 Iniciando captura de bookmarkState para tenantId: ${tenantId}`);

        // Tentar limpar processos órfãos antes de iniciar (apenas Windows)
        console.log('🧹 Verificando processos órfãos do Chrome...');
        await limparProcessosOrfaos();

        // Abrir navegador
        // Configurar argumentos do navegador e modo headless
        const isHeadless = headless !== false;
        const browserArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection'
        ];
        
        // Remover --no-zygote e --single-process que podem causar problemas
        // Esses argumentos podem causar "Target closed" em alguns ambientes
        
        console.log(`🌐 Lançando navegador (headless: ${isHeadless})...`);

        // Tentar lançar o navegador com retry e diferentes configurações
        const maxRetries = 3;
        let launchError = null;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🔄 Tentativa ${attempt}/${maxRetries} de lançar navegador...`);
                
        browser = await puppeteer.launch({
                    headless: isHeadless ? 'new' : false,
            defaultViewport: null,
                    args: browserArgs,
                    timeout: 30000 // Timeout de 30 segundos
                });
                
                // Aguardar um pouco para garantir que o navegador está estável
                await waitForTimeout(2000);
                
                // Verificar se o navegador ainda está conectado
                if (browser && browser.isConnected()) {
                    console.log(`✅ Navegador lançado com sucesso na tentativa ${attempt}!`);
                    launchError = null;
                    break;
                } else {
                    throw new Error('Navegador desconectado imediatamente após lançamento');
                }
            } catch (err) {
                launchError = err;
                console.log(`⚠️  Falha na tentativa ${attempt}/${maxRetries}: ${err.message}`);
                
                // Se não for a última tentativa, aguardar antes de tentar novamente
                if (attempt < maxRetries) {
                    const waitTime = attempt * 2000; // Aumentar o tempo de espera a cada tentativa
                    console.log(`⏳ Aguardando ${waitTime}ms antes da próxima tentativa...`);
                    await waitForTimeout(waitTime);
                    
                    // Tentar fechar qualquer processo órfão
                    if (browser && browser.isConnected()) {
                        try {
                            await browser.close();
                        } catch (e) {
                            // Ignorar erros ao fechar
                        }
                    }
                    browser = null;
                }
            }
        }

        if (!browser || !browser.isConnected()) {
            const errorMsg = launchError 
                ? `Não foi possível lançar o navegador após ${maxRetries} tentativas: ${launchError.message}`
                : `Não foi possível lançar o navegador após ${maxRetries} tentativas`;
            throw new Error(errorMsg);
        }

        // Listener para detectar quando o browser é fechado
        browser.on('disconnected', () => {
            console.log('⚠️  Browser desconectado');
        });

        // Criar página com verificação de estabilidade
        try {
            page = await browser.newPage();
            
            // Verificar se a página foi criada corretamente
            if (!page || page.isClosed()) {
                throw new Error('Página não foi criada corretamente ou foi fechada imediatamente');
            }
            
            console.log('✅ Página criada com sucesso');
        } catch (pageError) {
            console.error('❌ Erro ao criar página:', pageError.message);
            if (browser && browser.isConnected()) {
                await browser.close();
            }
            throw new Error(`Erro ao criar página: ${pageError.message}`);
        }

        // Listener para detectar quando a página é fechada
        page.on('close', () => {
            console.log('⚠️  Página fechada');
        });
        
        // Listener para erros na página
        page.on('error', (error) => {
            console.log('⚠️  Erro na página:', error.message);
        });

        // Configurar cookies para autenticação
        // O Conta Azul espera o token como cookie, não apenas como header
        await page.setCookie({
            name: 'auth-token-accountancy',
            value: accountancyToken,
            domain: '.contaazul.com',
            path: '/',
            httpOnly: false,
            secure: true,
            sameSite: 'None'
        });

        // Também configurar como header para requisições API
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

        // Primeiro, navegar para a página principal para estabelecer a sessão
        console.log('🔐 Navegando para página principal para estabelecer sessão...');
        if (!isConnected()) {
            throw new Error('Browser ou página não está mais conectado');
        }
        
        // Tentar navegar com retry em caso de erro de rede
        let navigationSuccess = false;
        let retries = 3;
        
        while (!navigationSuccess && retries > 0) {
            try {
                await page.goto('https://mais.contaazul.com/', {
                    waitUntil: 'networkidle2',
                    timeout: timeout
                });
                navigationSuccess = true;
            } catch (error) {
                if (error.message.includes('ERR_NETWORK_CHANGED') || error.message.includes('net::ERR')) {
                    console.log(`⚠️  Erro de rede (tentativa ${4 - retries}/3), aguardando 2 segundos e tentando novamente...`);
                    retries--;
                    if (retries > 0) {
                        await waitForTimeout(2000);
                    } else {
                        throw error;
                    }
                } else {
                    throw error;
                }
            }
        }

        // Aguardar um pouco para garantir que a sessão foi estabelecida
        await waitForTimeout(2000);

        // Verificar se foi redirecionado para login
        const currentUrl = page.url();
        if (currentUrl.includes('/login')) {
            console.log('⚠️  Foi redirecionado para login. Verificando autenticação...');
            // Tentar novamente após configurar cookies novamente
            await page.setCookie({
                name: 'auth-token-accountancy',
                value: accountancyToken,
                domain: '.contaazul.com',
                path: '/',
                httpOnly: false,
                secure: true,
                sameSite: 'None'
            });
            await waitForTimeout(1000);
            await page.reload({ waitUntil: 'networkidle2', timeout: timeout });
        }

        // Agora navegar até o dashboard
        const dashboardUrl = `https://mais.contaazul.com/#/dashboard-bi/${tenantId}/customer`;
        console.log(`📊 Navegando até: ${dashboardUrl}`);
        
        if (!isConnected()) {
            throw new Error('Browser ou página não está mais conectado');
        }
        
        // Tentar navegar com retry em caso de erro de rede
        navigationSuccess = false;
        retries = 3;
        
        while (!navigationSuccess && retries > 0) {
            try {
        await page.goto(dashboardUrl, {
            waitUntil: 'networkidle2',
            timeout: timeout
        });
                navigationSuccess = true;
            } catch (error) {
                if (error.message.includes('ERR_NETWORK_CHANGED') || error.message.includes('net::ERR')) {
                    console.log(`⚠️  Erro de rede ao navegar para dashboard (tentativa ${4 - retries}/3), aguardando 2 segundos e tentando novamente...`);
                    retries--;
                    if (retries > 0) {
                        await waitForTimeout(2000);
                    } else {
                        throw error;
                    }
                } else {
                    throw error;
                }
            }
        }

        // Aguardar o dashboard carregar (iframe do Power BI)
        console.log('⏳ Aguardando dashboard carregar...');
        try {
            if (!isConnected()) {
                throw new Error('Browser ou página não está mais conectado');
            }
            await page.waitForSelector('iframe[src*="powerbi"], iframe[src*="wabi"]', {
                timeout: waitForDashboard
            });
            console.log('✅ Dashboard carregado!');
        } catch (e) {
            if (e.message.includes('Target closed') || e.message.includes('Protocol error')) {
                throw e; // Re-throw para ser capturado no catch externo
            }
            console.log('⚠️  Timeout aguardando iframe do Power BI. Continuando...');
        }

        // Aguardar o dashboard carregar completamente
        console.log('⏳ Aguardando dashboard carregar completamente...');
        await waitForTimeout(10000); // Aguardar 10 segundos para o dashboard carregar

        // Encontrar e acessar o iframe do Power BI
        console.log('🔍 Procurando iframe do Power BI...');
        let powerBIFrame = null;
        try {
            if (!isConnected()) {
                throw new Error('Browser ou página não está mais conectado');
            }
            
            // Aguardar o iframe aparecer
            await page.waitForSelector('iframe[src*="powerbi"], iframe[src*="wabi"]', {
                timeout: 30000
            });
            
            // Obter o frame do Power BI
            const frames = page.frames();
            for (const frame of frames) {
                const url = frame.url();
                if (url.includes('powerbi') || url.includes('wabi')) {
                    powerBIFrame = frame;
                    console.log('✅ iframe do Power BI encontrado!');
                    break;
                }
            }
            
            // Se não encontrou pelo URL, tentar pelo elemento
            if (!powerBIFrame) {
                const iframeElement = await page.$('iframe[src*="powerbi"], iframe[src*="wabi"]');
                if (iframeElement) {
                    powerBIFrame = await iframeElement.contentFrame();
                    if (powerBIFrame) {
                        console.log('✅ iframe do Power BI encontrado via elemento!');
                    }
                }
                    }
                } catch (e) {
            console.log('⚠️  Não foi possível acessar o iframe do Power BI:', e.message);
        }

        // Rolar dentro do iframe do Power BI (se encontrado) ou na página principal
        console.log('📜 Rolando para encontrar "Realizado"...');
        if (!isConnected()) {
            throw new Error('Browser ou página não está mais conectado');
        }
        
        if (powerBIFrame) {
            // Rolar dentro do iframe
            try {
                await powerBIFrame.evaluate(() => {
                    window.scrollTo(0, document.body.scrollHeight);
                });
                console.log('✅ Rolou dentro do iframe do Power BI');
                await waitForTimeout(2000);
            } catch (e) {
                console.log('⚠️  Não foi possível rolar dentro do iframe, tentando na página principal');
                await page.evaluate(() => {
                    window.scrollTo(0, document.body.scrollHeight);
                });
                await waitForTimeout(2000);
            }
        } else {
            // Rolar na página principal
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });
            await waitForTimeout(2000);
        }

        // Tentar encontrar e clicar em "Realizado" dentro do BI
        // "Realizado" está dentro do iframe do Power BI, em um grid abaixo de "Fluxo de Caixa"
        console.log('🔘 Procurando e clicando em "Realizado" (botão no grid abaixo de "Fluxo de Caixa")...');
        try {
            if (!isConnected()) {
                throw new Error('Browser ou página não está mais conectado');
            }
            
            let realizadoClicked = false;
            
            // Aguardar um pouco mais para garantir que o dashboard carregou completamente
            console.log('⏳ Aguardando dashboard carregar completamente antes de procurar "Realizado"...');
            await waitForTimeout(5000);
            
            // Primeiro tentar dentro do iframe do Power BI
            if (powerBIFrame) {
                try {
                    // Estratégia 1: Procurar pelo div específico com classes "content text ui-role-button-text selected" e texto "Realizado"
                    console.log('🔍 Estratégia 1: Procurando div com classes "ui-role-button-text selected" e texto "Realizado"...');
                    
                    // Primeiro, encontrar o elemento usando evaluateHandle para poder usar Puppeteer para clicar
                    const realizadoElement = await powerBIFrame.evaluateHandle(() => {
                        const divs = Array.from(document.querySelectorAll('div.content.text.ui-role-button-text.selected, div.ui-role-button-text.selected, div[class*="ui-role-button-text"][class*="selected"]'));
                        
                        for (const div of divs) {
                            const text = (div.textContent || div.innerText || '').trim();
                            if (text === 'Realizado') {
                                return div;
                            }
                }
                return null;
            });

                    if (realizadoElement && realizadoElement.asElement()) {
                        console.log('✅ Div "Realizado" encontrado!');
                        
                        // Destacar o elemento
                        await powerBIFrame.evaluate((el) => {
                            const originalStyle = el.style.cssText;
                            el.style.cssText += 'border: 5px solid red !important; background-color: rgba(255, 0, 0, 0.3) !important; box-shadow: 0 0 20px red !important; z-index: 99999 !important; position: relative !important;';
                            setTimeout(() => {
                                el.style.cssText = originalStyle;
                            }, 5000);
                        }, realizadoElement);
                        
                        await waitForTimeout(2000);
                        
                        // Destacar em verde e clicar usando Puppeteer
                        await powerBIFrame.evaluate((el) => {
                            el.style.cssText += 'border: 5px solid lime !important; background-color: rgba(0, 255, 0, 0.3) !important; box-shadow: 0 0 20px lime !important;';
                        }, realizadoElement);
                        
                        // Fazer scroll
                        await powerBIFrame.evaluate((el) => {
                            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, realizadoElement);
                        
                        await waitForTimeout(1000);
                        
                        // Clicar usando Puppeteer (mais confiável)
                        try {
                            await realizadoElement.asElement().click({ delay: 100 });
                            realizadoClicked = true;
                            console.log('✅ "Realizado" clicado usando Puppeteer!');
                            
                            // Aguardar o conteúdo carregar após clicar em "Realizado"
                            console.log('⏳ Aguardando conteúdo carregar após clicar em "Realizado"...');
                            await waitForTimeout(2000); // Aguardar inicial
                            
                            // Verificar se o conteúdo carregou (procurar por indicadores de carregamento)
                            let contentLoaded = false;
                            let attempts = 0;
                            const maxAttempts = 10; // Máximo 5 segundos (10 * 500ms)
                            
                            while (!contentLoaded && attempts < maxAttempts) {
                                const isLoading = await powerBIFrame.evaluate(() => {
                                    // Verificar se há indicadores de carregamento
                                    const loaders = document.querySelectorAll('[class*="loading"], [class*="spinner"], [class*="loader"]');
                                    const hasVisibleLoader = Array.from(loaders).some(el => {
                                        const style = window.getComputedStyle(el);
                                        return style.display !== 'none' && style.visibility !== 'hidden';
                                    });
                                    
                                    // Verificar se o botão "Exportar PDF" já está disponível
                                    const exportButton = Array.from(document.querySelectorAll('.ds-loader-button__content, button, div, span')).find(el => {
                                        const text = (el.textContent || el.innerText || '').trim();
                                        return text === 'Exportar PDF' || (text.includes('Exportar') && text.includes('PDF'));
                                    });
                                    
                                    return {
                                        isLoading: hasVisibleLoader,
                                        exportButtonAvailable: !!exportButton
                                    };
                                });
                                
                                if (isLoading.exportButtonAvailable) {
                                    console.log('✅ Botão "Exportar PDF" já está disponível!');
                                    contentLoaded = true;
                                } else if (!isLoading.isLoading) {
                                    console.log('✅ Conteúdo carregado (sem indicadores de loading)');
                                    contentLoaded = true;
                                } else {
                                    attempts++;
                                    if (attempts % 4 === 0) { // A cada 2 segundos
                                        console.log(`⏳ Aguardando conteúdo carregar... (${attempts * 0.5}s)`);
                                    }
                                    await waitForTimeout(500);
                                }
                            }
                            
                            if (!contentLoaded) {
                                console.log('⚠️  Timeout aguardando conteúdo carregar, continuando...');
                            }
                        } catch (e) {
                            console.log('⚠️  Erro ao clicar com Puppeteer, tentando via evaluate...');
                            // Fallback para evaluate
                            realizadoClicked = await powerBIFrame.evaluate(() => {
                        // Função para destacar um elemento visualmente
                        function highlightElement(el, color = 'red', duration = 3000) {
                            const originalStyle = el.style.cssText;
                            el.style.cssText += `border: 5px solid ${color} !important; background-color: rgba(255, 0, 0, 0.3) !important; box-shadow: 0 0 20px ${color} !important; z-index: 99999 !important; position: relative !important;`;
                            
                            setTimeout(() => {
                                el.style.cssText = originalStyle;
                            }, duration);
                        }
                        
                        // Procurar especificamente pelo div com as classes corretas
                        const divs = Array.from(document.querySelectorAll('div.content.text.ui-role-button-text.selected, div.ui-role-button-text.selected, div[class*="ui-role-button-text"][class*="selected"]'));
                        
                        for (const div of divs) {
                            const text = (div.textContent || div.innerText || '').trim();
                            
                            // Verificar se o texto é exatamente "Realizado"
                            if (text === 'Realizado') {
                                console.log('✅ Div "Realizado" encontrado com classes corretas!');
                                
                                try {
                                    // Verificar se o elemento está visível
                                    const rect = div.getBoundingClientRect();
                                    if (rect.width > 0 && rect.height > 0) {
                                        // Destacar o elemento em VERMELHO
                                        highlightElement(div, 'red', 5000);
                                        console.log('🎨 Elemento "Realizado" destacado em VERMELHO!');
                                        
                                        // Fazer scroll para o elemento
                                        div.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                        
                                        // Aguardar um pouco antes de clicar para o usuário ver o destaque
                                        setTimeout(() => {
                                            // Destacar em VERDE antes de clicar
                                            highlightElement(div, 'lime', 3000);
                                            
                                            // Tentar múltiplas estratégias de clique
                                            let clicked = false;
                                            
                                            // Estratégia 1: Clicar no próprio div
                                            try {
                                                div.click();
                                                clicked = true;
                                                console.log('✅ Clique executado no div "Realizado" (método 1)');
                                            } catch (e) {
                                                console.log('⚠️  Método 1 falhou:', e.message);
                                            }
                                            
                                            // Estratégia 2: Evento MouseEvent
                                            if (!clicked) {
                                                try {
                                                    const event = new MouseEvent('click', {
                                                        bubbles: true,
                                                        cancelable: true,
                                                        view: window,
                                                        button: 0,
                                                        buttons: 1
                                                    });
                                                    div.dispatchEvent(event);
                                                    clicked = true;
                                                    console.log('✅ Clique via MouseEvent executado (método 2)');
                                                } catch (e2) {
                                                    console.log('⚠️  Método 2 falhou:', e2.message);
                                                }
                                            }
                                            
                                            // Estratégia 3: Clicar no elemento pai
                                            if (!clicked) {
                                                try {
                                                    let parent = div.parentElement;
                                                    let attempts = 0;
                                                    while (parent && attempts < 5) {
                                                        highlightElement(parent, 'lime', 2000);
                                                        parent.click();
                                                        clicked = true;
                                                        console.log('✅ Clique executado no elemento pai (método 3)');
                                                        break;
                                                    }
                                                } catch (e3) {
                                                    console.log('⚠️  Método 3 falhou:', e3.message);
                                                }
                                            }
                                            
                                            // Estratégia 4: Usar coordenadas do elemento
                                            if (!clicked) {
                                                try {
                                                    const rect = div.getBoundingClientRect();
                                                    const x = rect.left + rect.width / 2;
                                                    const y = rect.top + rect.height / 2;
                                                    
                                                    const mouseDown = new MouseEvent('mousedown', {
                                                        bubbles: true,
                                                        cancelable: true,
                                                        view: window,
                                                        button: 0,
                                                        clientX: x,
                                                        clientY: y
                                                    });
                                                    
                                                    const mouseUp = new MouseEvent('mouseup', {
                                                        bubbles: true,
                                                        cancelable: true,
                                                        view: window,
                                                        button: 0,
                                                        clientX: x,
                                                        clientY: y
                                                    });
                                                    
                                                    const clickEvent = new MouseEvent('click', {
                                                        bubbles: true,
                                                        cancelable: true,
                                                        view: window,
                                                        button: 0,
                                                        clientX: x,
                                                        clientY: y
                                                    });
                                                    
                                                    div.dispatchEvent(mouseDown);
                                                    setTimeout(() => {
                                                        div.dispatchEvent(mouseUp);
                                                        div.dispatchEvent(clickEvent);
                                                    }, 100);
                                                    
                                                    clicked = true;
                                                    console.log('✅ Clique via coordenadas executado (método 4)');
                                                } catch (e4) {
                                                    console.log('⚠️  Método 4 falhou:', e4.message);
                                                }
                                            }
                                            
                                            if (!clicked) {
                                                console.log('❌ Nenhum método de clique funcionou');
                                            }
                                        }, 2000); // Aguardar 2 segundos para o usuário ver o destaque
                                        
                                        return true;
                                    }
                                } catch (e) {
                                    console.log('⚠️  Erro ao processar div:', e.message);
                                }
                            }
                        }
                        
                        // Fallback: Procurar por qualquer div com texto "Realizado" e classes relacionadas
                        const allDivs = Array.from(document.querySelectorAll('div'));
                        for (const div of allDivs) {
                            const text = (div.textContent || div.innerText || '').trim();
                            const classes = div.className || '';
                            
                            if (text === 'Realizado' && 
                                (classes.includes('ui-role-button-text') || classes.includes('selected'))) {
                                try {
                                    const rect = div.getBoundingClientRect();
                                    if (rect.width > 0 && rect.height > 0) {
                                        div.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                        setTimeout(() => {
                                            try {
                                                div.click();
                                            } catch (e) {
                                                const event = new MouseEvent('click', {
                                                    bubbles: true,
                                                    cancelable: true,
                                                    view: window,
                                                    button: 0
                                                });
                                                div.dispatchEvent(event);
                                            }
                                        }, 500);
                                        return true;
                                    }
                                } catch (e) {
                                    // Continuar
                                }
                            }
                        }
                        
                        return false;
                    });
                        } // Fechar o catch da linha 360
                    }
                    
                    if (realizadoClicked) {
                        console.log('✅ "Realizado" clicado (Estratégia 1)!');
                        await waitForTimeout(3000); // Aguardar o dashboard processar o clique
                    }
                    
                    // Estratégia 2: Procurar por grid que contém "Previsto x Realizado" e então procurar "Realizado"
                    if (!realizadoClicked) {
                        console.log('🔍 Estratégia 2: Procurando grid com "Previsto x Realizado"...');
                        realizadoClicked = await powerBIFrame.evaluate(() => {
                            const allGrids = Array.from(document.querySelectorAll('grid, [role="grid"]'));
                            
                            for (const grid of allGrids) {
                                const gridText = grid.textContent || '';
                                
                                if (gridText.includes('Previsto x Realizado') || gridText.includes('Orçado x Realizado')) {
                                    console.log('✅ Grid encontrado!');
                                    
                                    const gridCells = grid.querySelectorAll('gridcell, [role="gridcell"], td');
                                    
                                    for (const cell of gridCells) {
                                        const cellText = (cell.textContent || '').trim();
                                        
                                        if (cellText === 'Realizado' || 
                                            (cellText.includes('Realizado') && 
                                             !cellText.includes('Previsto') && 
                                             !cellText.includes('Orçado') &&
                                             cellText.length < 50)) {
                                            
                                            console.log('✅ Gridcell "Realizado" encontrado no grid!');
                                            
                                            // Procurar por qualquer elemento clicável
                                            const clickable = cell.querySelector('button, [role="button"], path, g, svg, div, span');
                                            
                                            if (clickable) {
                                                try {
                                                    const rect = clickable.getBoundingClientRect();
                                                    if (rect.width > 0 && rect.height > 0) {
                                                        clickable.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                        setTimeout(() => {
                                                            try {
                                                                clickable.click();
                                                            } catch (e) {
                                                                const event = new MouseEvent('click', {
                                                                    bubbles: true,
                                                                    cancelable: true,
                                                                    view: window,
                                                                    button: 0
                                                                });
                                                                clickable.dispatchEvent(event);
                                                            }
                                                        }, 500);
                                                        return true;
            }
        } catch (e) {
                                                    // Tentar clicar no próprio cell
                                                    try {
                                                        cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                        setTimeout(() => cell.click(), 500);
                                                        return true;
                                                    } catch (e2) {}
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            
                            return false;
                        });
                        
                        if (realizadoClicked) {
                            console.log('✅ "Realizado" clicado (Estratégia 2)!');
                            await waitForTimeout(3000);
                        }
                    }
                    
                    // Estratégia 3: Procurar por qualquer elemento com texto "Realizado" e clicar
                    if (!realizadoClicked) {
                        console.log('🔍 Estratégia 3: Procurando qualquer elemento com texto "Realizado"...');
                        realizadoClicked = await powerBIFrame.evaluate(() => {
                            // Procurar por todos os elementos que podem conter "Realizado"
                            const allElements = Array.from(document.querySelectorAll('*'));
                            
                            for (const el of allElements) {
                                const text = (el.textContent || el.innerText || '').trim();
                                
                                if (text === 'Realizado' || 
                                    (text === 'Realizado' && 
                                     el.tagName && 
                                     (el.tagName.toLowerCase() === 'button' || 
                                      el.tagName.toLowerCase() === 'path' ||
                                      el.getAttribute('role') === 'button'))) {
                                    
                                    try {
                                        const rect = el.getBoundingClientRect();
                                        if (rect.width > 0 && rect.height > 0) {
                                            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                            setTimeout(() => {
                                                try {
                                                    el.click();
                                                } catch (e) {
                                                    const event = new MouseEvent('click', {
                                                        bubbles: true,
                                                        cancelable: true,
                                                        view: window,
                                                        button: 0
                                                    });
                                                    el.dispatchEvent(event);
                                                }
                                            }, 500);
                                            return true;
                                        }
                                    } catch (e) {
                                        // Continuar
                                    }
                                }
                            }
                            
                            return false;
                        });
                        
                        if (realizadoClicked) {
                            console.log('✅ "Realizado" clicado (Estratégia 3)!');
                            await waitForTimeout(3000);
                        }
                    }
                    
                    if (!realizadoClicked) {
                        console.log('⚠️  Não foi possível clicar automaticamente em "Realizado"');
                        console.log('💡 Tentando rolar a página para baixo para tornar o botão visível...');
                        
                        // Rolar a página para baixo
                        await powerBIFrame.evaluate(() => {
                            window.scrollTo(0, document.body.scrollHeight);
                        });
                        
                        await waitForTimeout(2000);
                        
                        // Tentar novamente a Estratégia 1 após rolar
                        realizadoClicked = await powerBIFrame.evaluate(() => {
                            const allCells = Array.from(document.querySelectorAll('gridcell, [role="gridcell"], td'));
                            
                            for (const cell of allCells) {
                                const cellText = (cell.textContent || '').trim();
                                
                                if (cellText === 'Realizado' || 
                                    (cellText.includes('Realizado') && 
                                     !cellText.includes('Previsto') && 
                                     !cellText.includes('Orçado') &&
                                     cellText.length < 50)) {
                                    
                                    const clickable = cell.querySelector('button, [role="button"], path, g, svg, div, span');
                                    
                                    if (clickable) {
                                        try {
                                            const rect = clickable.getBoundingClientRect();
                                            if (rect.width > 0 && rect.height > 0) {
                                                clickable.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                setTimeout(() => {
                                                    try {
                                                        clickable.click();
                                                    } catch (e) {
                                                        const event = new MouseEvent('click', {
                                                            bubbles: true,
                                                            cancelable: true,
                                                            view: window,
                                                            button: 0
                                                        });
                                                        clickable.dispatchEvent(event);
                                                    }
                                                }, 500);
                                                return true;
                                            }
                                        } catch (e) {
                                            try {
                                                cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                setTimeout(() => cell.click(), 500);
                                                return true;
                                            } catch (e2) {}
                                        }
                                    }
                                }
                            }
                            
                            return false;
                        });
                        
                        if (realizadoClicked) {
                            console.log('✅ "Realizado" clicado após rolar a página!');
                            await waitForTimeout(3000);
                        }
                    }
                } catch (e) {
                    console.log('⚠️  Erro ao tentar clicar em "Realizado":', e.message);
                }
                
                if (realizadoClicked) {
                    console.log('✅ "Realizado" clicado dentro do iframe!');
                    await waitForTimeout(5000); // Aguardar carregar após clicar em Realizado
                } else {
                    console.log('⚠️  Botão "Realizado" não encontrado no iframe');
                }
            }
            
            // Se não encontrou no iframe, tentar na página principal (fallback)
            if (!realizadoClicked) {
                realizadoClicked = await page.evaluate(() => {
                    // Procurar por botão "Realizado" na página principal
                    const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
                    for (const btn of allButtons) {
                        const text = (btn.textContent || btn.innerText || '').trim();
                        if (text === 'Realizado') {
                            try {
                                btn.click();
                                return true;
                            } catch (e) {
                                try {
                                    const event = new MouseEvent('click', {
                                        bubbles: true,
                                        cancelable: true,
                                        view: window
                                    });
                                    btn.dispatchEvent(event);
                                    return true;
                                } catch (e2) {
                                    // Ignorar erros
                                }
                            }
                        }
                    }
                    return false;
                });
                
                if (realizadoClicked) {
                    console.log('✅ "Realizado" clicado na página principal!');
                    await waitForTimeout(5000); // Aguardar carregar após clicar em Realizado
                } else {
                    console.log('⚠️  Botão "Realizado" não encontrado em nenhum lugar');
                    console.log('💡 Aguardando 5 segundos para o dashboard processar...');
                    await waitForTimeout(5000);
                }
            }
        } catch (e) {
            console.log('⚠️  Erro ao clicar em "Realizado":', e.message);
            console.log('💡 Aguardando 5 segundos e continuando...');
            await waitForTimeout(5000);
        }

        // Agora clicar em "Exportar PDF"
        // Baseado na captura: className="ds-loader-button__content", textContent="Exportar PDF"
        console.log('📥 Procurando e clicando em "Exportar PDF"...');
        try {
            if (!isConnected()) {
                throw new Error('Browser ou página não está mais conectado');
            }
            
            // Aguardar o botão "Exportar PDF" estar disponível (com timeout inteligente)
            let exportButton = null;
            let attempts = 0;
            const maxAttempts = 20; // Máximo 10 segundos (20 * 500ms)
            
            console.log('⏳ Aguardando botão "Exportar PDF" estar disponível...');
            while (!exportButton && attempts < maxAttempts) {
                // Tentar encontrar o botão
                exportButton = await page.$('.ds-loader-button__content');
                
                if (exportButton) {
                    const text = await page.evaluate(el => el.textContent?.trim(), exportButton);
                    if (text === 'Exportar PDF') {
                        console.log('✅ Botão "Exportar PDF" encontrado!');
                        break;
                    } else {
                        exportButton = null;
                    }
                }
                
                if (!exportButton) {
                    attempts++;
                    if (attempts % 4 === 0) { // A cada 2 segundos
                        console.log(`⏳ Aguardando botão "Exportar PDF"... (${attempts * 0.5}s)`);
                    }
                    await waitForTimeout(500);
                }
            }
            
            // Primeiro tentar pelo seletor CSS específico (mais confiável)
            let exportClicked = false;
            if (exportButton) {
                try {
                    await exportButton.click();
                    exportClicked = true;
                    console.log('✅ Botão "Exportar PDF" clicado (via seletor CSS)!');
                } catch (e) {
                    console.log('⚠️  Erro ao clicar no botão encontrado:', e.message);
                }
            } else {
                console.log('⚠️  Botão "Exportar PDF" não encontrado após aguardar, tentando método alternativo...');
            }
            
            // Se não encontrou, tentar por texto
            if (!exportClicked) {
                exportClicked = await page.evaluate(() => {
                    // Procurar por elementos com classe ds-loader-button__content
                    const elements = Array.from(document.querySelectorAll('.ds-loader-button__content'));
                    for (const el of elements) {
                        const text = (el.textContent || el.innerText || '').trim();
                        if (text === 'Exportar PDF' || (text.includes('Exportar') && text.includes('PDF'))) {
                            try {
                                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                el.click();
                                return true;
                            } catch (e) {
                                try {
                                    const event = new MouseEvent('click', {
                                        bubbles: true,
                                        cancelable: true,
                                        view: window
                                    });
                                    el.dispatchEvent(event);
                                    return true;
                                } catch (e2) {
                                    // Ignorar erros
                                }
                            }
                        }
                    }
                    
                    // Fallback: procurar por qualquer elemento com texto "Exportar PDF"
                    const allElements = Array.from(document.querySelectorAll('button, div, span, a, [role="button"]'));
                    for (const el of allElements) {
                        const text = (el.textContent || el.innerText || '').trim();
                        if (text === 'Exportar PDF' || (text.includes('Exportar') && text.includes('PDF'))) {
                            try {
                                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                el.click();
                                return true;
                            } catch (e) {
                                try {
                                    const event = new MouseEvent('click', {
                                        bubbles: true,
                                        cancelable: true,
                                        view: window
                                    });
                                    el.dispatchEvent(event);
                                    return true;
                                } catch (e2) {
                                    // Ignorar erros
                                }
                            }
                        }
                    }
                    
                    return false;
                });
                
                if (exportClicked) {
                    console.log('✅ Botão "Exportar PDF" clicado (via método alternativo)!');
                }
            }
            
            if (exportClicked) {
                    console.log('✅ Botão "Exportar PDF" clicado!');
                await waitForTimeout(5000); // Aguardar requisição de exportação
                } else {
                    console.log('⚠️  Botão "Exportar PDF" não encontrado');
                }
            
            } catch (e) {
            console.log('⚠️  Erro ao clicar no botão "Exportar PDF":', e.message);
        }

        // Se ainda não temos bookmarkState, retornar null
        if (!bookmarkState) {
            console.log('❌ bookmarkState não foi capturado');
            console.log('💡 Dica: O bookmarkState só é gerado quando o usuário interage com o dashboard');
            console.log('💡 Dica: Tente usar o bookmarkState já capturado anteriormente');
        }

    } catch (error) {
        console.error('❌ Erro durante captura:', error.message);
        
        // Se o erro for relacionado ao browser já estar fechado, não tentar fechar novamente
        if (error.message.includes('Target closed') || 
            error.message.includes('Protocol error') || 
            error.message.includes('Session closed')) {
            console.log('⚠️  Browser já foi fechado');
        } else {
            // Para outros erros, tentar fechar o browser se ainda estiver aberto
            if (browser && browser.isConnected()) {
                try {
                    await browser.close();
                } catch (closeError) {
                    console.log('⚠️  Erro ao fechar browser:', closeError.message);
                }
            }
        }
        
        throw error;
    } finally {
        // Fechar browser apenas se ainda estiver conectado
        if (browser && browser.isConnected()) {
            try {
                // Aguardar um pouco antes de fechar
                await waitForTimeout(1000);
                
            await browser.close();
                console.log('🔒 Browser fechado');
            } catch (closeError) {
                // Ignorar erros ao fechar (pode já estar fechado)
            }
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
