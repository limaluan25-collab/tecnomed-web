require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'tecnomed.se@gmail.com',
        pass: 'evhcaymsjijtftpe'
    }
});

app.post('/api/upload', upload.fields([
    { name: 'relatorio', maxCount: 1 },
    { name: 'fotos', maxCount: 10 },
    { name: 'assinatura', maxCount: 1 }
]), async (req, res) => {
    try {
        console.log('--- Novo Relatório Recebido ---');

        const cliente = req.body.nomeCliente || 'Cliente';
        const emailCliente = req.body.emailCliente;

        if (!emailCliente) {
            throw new Error('Email do cliente não fornecido.');
        }

        const attachments = [];

        // Relatório PDF
        if (req.files['relatorio']) {
            const f = req.files['relatorio'][0];
            attachments.push({
                filename: f.originalname || 'Relatorio_Tecnomed.pdf',
                content: f.buffer,
                contentType: 'application/pdf'
            });
        }

        // Fotos separadas (se o usuário quiser)
        if (req.files['fotos']) {
            req.files['fotos'].forEach((f, index) => {
                attachments.push({
                    filename: `anexo_foto_${index + 1}.jpg`,
                    content: f.buffer,
                    contentType: f.mimetype
                });
            });
        }

        const mailOptions = {
            from: `"Tecnomed Assistência Técnica" <tecnomed.se@gmail.com>`,
            to: ['tecnomed.se@gmail.com', emailCliente].filter(Boolean),
            subject: `Relatório de Manutenção - ${cliente}`,
            text: `Olá, segue em anexo o relatório de manutenção do equipamento para o cliente ${cliente}.\n\nEste é um e-mail automático enviado pelo sistema Tecnomed Web.`,
            attachments: attachments
        };

        await transporter.sendMail(mailOptions);
        res.status(200).send('Relatório enviado com sucesso!');
    } catch (error) {
        console.error('Erro no processamento:', error);
        res.status(500).send('Erro: ' + error.message);
    }
});

if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Servidor rodando localmente na porta ${PORT}`);
    });
}

module.exports = app;
