require('dotenv').config();

const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const nodemailer = require('nodemailer');
const { kv } = require('@vercel/kv');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const ACCESS_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const ACCESS_CODE = process.env.APP_ACCESS_CODE || '';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE).toLowerCase() === 'true';
const SMTP_USER = process.env.SMTP_USER || process.env.EMAIL_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || process.env.EMAIL_PASS || '';
const REPORT_COPY_TO = process.env.REPORT_COPY_TO || '';
const fs = require('node:fs');
const path = require('node:path');
const counterFilePath = path.join(__dirname, 'counter.json');

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
    const contentLength = Number(req.headers['content-length'] || 0);
    if (contentLength > MAX_UPLOAD_BYTES) {
        return res.status(413).json({ accepted: false, error: 'O arquivo excede o limite de 4 MB.' });
    }
    next();
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 11, fields: 20, fieldSize: 1024 * 1024 }
});

const loginAttempts = new Map();
let memoryCounter = 0;
let transporter;

function codigoConfigurado() {
    return ACCESS_CODE.length >= 20;
}

function codigoCorreto(informado) {
    if (typeof informado !== 'string') return false;
    const esperado = crypto.createHash('sha256').update(ACCESS_CODE).digest();
    const recebido = crypto.createHash('sha256').update(informado).digest();
    return crypto.timingSafeEqual(esperado, recebido);
}

function criarTokenAcesso() {
    const payload = Buffer.from(JSON.stringify({
        exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS,
        sub: 'tecnomed'
    })).toString('base64url');
    const assinatura = crypto.createHmac('sha256', ACCESS_CODE).update(payload).digest('base64url');
    return `${payload}.${assinatura}`;
}

function tokenAcessoValido(token) {
    if (typeof token !== 'string') return false;
    const partes = token.split('.');
    if (partes.length !== 2) return false;

    const assinaturaEsperada = crypto.createHmac('sha256', ACCESS_CODE).update(partes[0]).digest();
    let assinaturaInformada;
    try {
        assinaturaInformada = Buffer.from(partes[1], 'base64url');
    } catch {
        return false;
    }
    if (assinaturaInformada.length !== assinaturaEsperada.length ||
        !crypto.timingSafeEqual(assinaturaEsperada, assinaturaInformada)) return false;

    try {
        const payload = JSON.parse(Buffer.from(partes[0], 'base64url').toString('utf8'));
        return payload.sub === 'tecnomed' && Number(payload.exp) > Math.floor(Date.now() / 1000);
    } catch {
        return false;
    }
}

function exigirAcesso(req, res, next) {
    if (!codigoConfigurado()) {
        return res.status(503).json({
            accepted: false,
            error: 'O código de acesso da equipe ainda não foi configurado no servidor.'
        });
    }
    const cabecalho = req.headers.authorization || '';
    const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : '';
    if (!tokenAcessoValido(token)) {
        return res.status(401).json({ accepted: false, error: 'Acesso expirado ou inválido. Informe novamente o código da equipe.' });
    }
    next();
}

function transporterSMTP() {
    const emailsCopia = REPORT_COPY_TO.split(/[;,]/).map(email => email.trim()).filter(Boolean);
    if (!SMTP_USER || !SMTP_PASS || !emailsCopia.length ||
        emailsCopia.some(email => !extrairEmailValido(email)) ||
        !Number.isInteger(SMTP_PORT) || SMTP_PORT < 1) {
        throw new Error('Configuração de e-mail incompleta no servidor.');
    }
    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: SMTP_PORT,
            secure: SMTP_SECURE,
            auth: { user: SMTP_USER, pass: SMTP_PASS }
        });
    }
    return transporter;
}

function extrairEmailValido(valor) {
    return typeof valor === 'string' &&
        /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(valor.trim());
}

function limparTexto(valor, limite = 160) {
    return String(valor || '').replace(/[\r\n]+/g, ' ').trim().slice(0, limite);
}

function validarAssinaturaPNG(dataUri) {
    const match = typeof dataUri === 'string' &&
        dataUri.match(/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) return false;
    try {
        const bytes = Buffer.from(match[1], 'base64');
        return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    } catch {
        return false;
    }
}

function respostaUploadErro(error, res) {
    if (error instanceof multer.MulterError) {
        const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        const mensagem = error.code === 'LIMIT_FILE_SIZE'
            ? 'O arquivo excede o limite de 4 MB.'
            : 'O formulário contém anexos ou campos inválidos.';
        return res.status(status).json({ accepted: false, error: mensagem });
    }
    console.error('Erro no processamento do relatório:', error);
    const status = error.message === 'Configuração de e-mail incompleta no servidor.' ? 503 : 500;
    return res.status(status).json({
        accepted: false,
        error: status === 503 ? error.message : 'Não foi possível enviar o relatório. Tente novamente.'
    });
}

app.get('/api/counter', async (req, res) => {
    try {
        if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
            return res.json({ id: await kv.incr('tecnomed_relatorio_counter') });
        }

        if (fs.existsSync(counterFilePath)) {
            try {
                const data = JSON.parse(fs.readFileSync(counterFilePath, 'utf8'));
                memoryCounter = Number(data.count) || 0;
            } catch (error) {
                console.error('Erro ao ler counter.json:', error);
            }
        }
        memoryCounter += 1;
        try {
            fs.writeFileSync(counterFilePath, JSON.stringify({ count: memoryCounter }));
        } catch (error) {
            console.error('Erro ao salvar counter.json:', error);
        }
        return res.json({ id: memoryCounter });
    } catch (error) {
        console.error('Erro ao gerar contador:', error);
        return res.status(503).json({ error: 'Não foi possível reservar o número do relatório.' });
    }
});

app.post('/api/auth', (req, res) => {
    if (!codigoConfigurado()) {
        return res.status(503).json({ error: 'O código de acesso da equipe ainda não foi configurado no servidor.' });
    }

    const agora = Date.now();
    const chave = req.ip || req.socket.remoteAddress || 'unknown';
    const tentativasRecentes = (loginAttempts.get(chave) || []).filter(tentativa => agora - tentativa < 15 * 60 * 1000);
    if (tentativasRecentes.length >= 10) {
        loginAttempts.set(chave, tentativasRecentes);
        return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' });
    }
    tentativasRecentes.push(agora);
    loginAttempts.set(chave, tentativasRecentes);

    if (!codigoCorreto(req.body?.code)) {
        return res.status(401).json({ error: 'Código de acesso incorreto.' });
    }
    loginAttempts.delete(chave);
    return res.json({ token: criarTokenAcesso() });
});

app.post('/api/upload', exigirAcesso, upload.any(), async (req, res) => {
    try {
        const arquivos = Array.isArray(req.files) ? req.files : [];
        const pdf = arquivos.find(arquivo => arquivo.fieldname === 'file' || arquivo.fieldname === 'relatorio');
        if (!pdf || pdf.mimetype !== 'application/pdf' || pdf.buffer.subarray(0, 5).toString() !== '%PDF-') {
            return res.status(400).json({ accepted: false, error: 'O relatório PDF é obrigatório ou inválido.' });
        }

        let metadata;
        try {
            metadata = JSON.parse(req.body.metadata || '{}');
        } catch {
            return res.status(400).json({ accepted: false, error: 'Os dados do relatório são inválidos.' });
        }
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
            return res.status(400).json({ accepted: false, error: 'Os dados do relatório são inválidos.' });
        }

        const emailCliente = String(metadata.emailCliente || '').trim();
        if (!extrairEmailValido(emailCliente)) {
            return res.status(400).json({ accepted: false, error: 'O e-mail do cliente é obrigatório e deve ser válido.' });
        }
        if (!validarAssinaturaPNG(metadata.assinatura || metadata.assinaturaCliente) ||
            !validarAssinaturaPNG(metadata.assinaturaTecnico)) {
            return res.status(400).json({ accepted: false, error: 'As assinaturas do cliente e do técnico são obrigatórias.' });
        }

        const fotos = arquivos.filter(arquivo => /^foto_\d+$/.test(arquivo.fieldname));
        if (fotos.some(foto => !['image/jpeg', 'image/png', 'image/webp'].includes(foto.mimetype))) {
            return res.status(400).json({ accepted: false, error: 'Um ou mais anexos de foto têm formato inválido.' });
        }

        const cliente = limparTexto(metadata.cliente, 120) || 'Cliente';
        const numero = limparTexto(metadata.id, 20) || 'sem-numero';
        const attachments = [{
            filename: `Relatorio_${numero}.pdf`,
            content: pdf.buffer,
            contentType: 'application/pdf'
        }, ...fotos.map((foto, indice) => ({
            filename: `anexo_foto_${indice + 1}.${foto.mimetype.split('/')[1]}`,
            content: foto.buffer,
            contentType: foto.mimetype
        }))];

        const transport = transporterSMTP();
        const emailsCopia = REPORT_COPY_TO.split(/[;,]/).map(email => email.trim()).filter(Boolean);
        const info = await transport.sendMail({
            from: {
                name: process.env.SMTP_FROM_NAME || 'Tecnomed Assistência Técnica',
                address: process.env.SMTP_FROM || SMTP_USER
            },
            to: emailCliente,
            cc: emailsCopia,
            subject: `Relatório de Manutenção - ${cliente}`,
            text: `Olá, segue em anexo o relatório de manutenção do equipamento para ${cliente}.\n\nEste é um e-mail automático enviado pelo sistema Tecnomed Web.`,
            attachments
        });

        const aceitos = new Set((info.accepted || []).map(endereco => String(endereco).toLowerCase()));
        const destinatarios = [emailCliente, ...emailsCopia];
        const recusados = destinatarios.filter(endereco => !aceitos.has(endereco.toLowerCase()));
        if (recusados.length) {
            console.error('O servidor SMTP não aceitou todos os destinatários do relatório.');
            return res.status(502).json({ accepted: false, error: 'O servidor de e-mail não aceitou todos os destinatários.' });
        }

        console.log(`Relatório ${numero} aceito pelo servidor SMTP. ID: ${info.messageId}`);
        return res.json({ accepted: true, message: 'Relatório aceito para envio pelo servidor de e-mail.' });
    } catch (error) {
        return respostaUploadErro(error, res);
    }
});

app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) return respostaUploadErro(error, res);
    console.error('Erro inesperado na API:', error);
    return res.status(500).json({ accepted: false, error: 'Erro interno ao processar a solicitação.' });
});

if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Servidor rodando localmente na porta ${PORT}`);
    });
}

module.exports = app;
