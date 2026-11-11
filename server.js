require("dotenv").config();

const cors = require("cors");
const express = require("express");
const fs = require("fs");
const multer = require("multer");
const nodemailer = require("nodemailer");
const path = require("path");

const app = express();
const port = Number(process.env.PORT || 3000);
const maxUploadBytes = 4 * 1024 * 1024;
const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:3011",
  ...(process.env.CORS_ORIGINS || "").split(",").map(origin => origin.trim()).filter(Boolean)
]);

app.use(cors((request, callback) => {
  const origin = request.get("Origin");
  const sameOrigin = origin && origin === `${request.protocol}://${request.get("host")}`;
  if (!origin || allowedOrigins.has(origin) || sameOrigin) return callback(null, { origin: true });
  return callback(new Error("Origem não autorizada."));
}));
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use((request, response, next) => {
  if (Number(request.headers["content-length"] || 0) > maxUploadBytes) {
    return response.status(413).json({ accepted: false, error: "O arquivo excede o limite de 4 MB." });
  }
  next();
});

const counterFilePath = path.join(__dirname, "counter.json");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxUploadBytes, files: 11, fields: 20, fieldSize: 1024 * 1024 },
  fileFilter(request, file, callback) {
    const isPdf = file.fieldname === "file" && file.mimetype === "application/pdf";
    const isPhoto = /^foto_\d+$/.test(file.fieldname) && ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    if (isPdf || isPhoto) return callback(null, true);
    return callback(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
  }
});

function assinaturaPngValida(valor) {
  const correspondencia = typeof valor === "string" &&
    valor.match(/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!correspondencia) return false;
  const bytes = Buffer.from(correspondencia[1], "base64");
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

function textoSeguro(valor, limite = 160) {
  return String(valor || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, limite);
}

function emailsCopia() {
  return (process.env.REPORT_COPY_TO || "").split(/[;,]/).map(email => email.trim()).filter(Boolean);
}

function smtpConfigurado() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS &&
    emailsCopia().length && emailsCopia().every(email => /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email)));
}

app.get("/health", (request, response) => {
  response.json({ ok: true, smtpConfigured: smtpConfigurado() });
});

app.get("/api/counter", (request, response) => {
  let count = 1;
  if (fs.existsSync(counterFilePath)) {
    try {
      count = (Number(JSON.parse(fs.readFileSync(counterFilePath, "utf8")).count) || 0) + 1;
    } catch (error) {
      console.error("Erro ao ler counter.json:", error);
    }
  }
  try {
    fs.writeFileSync(counterFilePath, JSON.stringify({ count }));
  } catch (error) {
    console.error("Erro ao salvar counter.json:", error);
  }
  response.json({ id: count });
});

app.post(["/upload", "/api/upload"], upload.any(), async (request, response) => {
  let metadata;
  try {
    metadata = JSON.parse(request.body.metadata || "{}");
  } catch {
    return response.status(400).json({ accepted: false, error: "Os dados do relatório são inválidos." });
  }

  const emailCliente = String(metadata.emailCliente || "").trim();
  const pdf = (request.files || []).find(file => file.fieldname === "file");
  const assinaturaCliente = metadata.assinatura || metadata.assinaturaCliente;
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(emailCliente)) {
    return response.status(400).json({ accepted: false, error: "Informe um e-mail válido para o cliente." });
  }
  if (!assinaturaPngValida(assinaturaCliente) || !assinaturaPngValida(metadata.assinaturaTecnico)) {
    return response.status(400).json({ accepted: false, error: "As assinaturas do cliente e do técnico são obrigatórias." });
  }
  if (!pdf || !pdf.buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    return response.status(400).json({ accepted: false, error: "O arquivo PDF do relatório está ausente ou inválido." });
  }
  if (!smtpConfigurado()) {
    return response.status(503).json({ accepted: false, error: "O envio de e-mail não está configurado no servidor." });
  }

  const numero = String(metadata.id || "").replace(/\D/g, "").slice(0, 12) || "sem-numero";
  const cliente = textoSeguro(metadata.cliente, 120) || "Cliente";
  const anexos = [{
    filename: `Relatorio_${numero.padStart(4, "0")}.pdf`,
    content: pdf.buffer,
    contentType: "application/pdf"
  }];
  for (const [indice, foto] of (request.files || []).filter(file => /^foto_\d+$/.test(file.fieldname)).entries()) {
    anexos.push({
      filename: `anexo_foto_${indice + 1}.${foto.mimetype.split("/")[1]}`,
      content: foto.buffer,
      contentType: foto.mimetype
    });
  }

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  try {
    const info = await transport.sendMail({
      from: {
        name: textoSeguro(process.env.SMTP_FROM_NAME || "Tecnomed"),
        address: process.env.SMTP_FROM || process.env.SMTP_USER
      },
      to: emailCliente,
      cc: emailsCopia(),
      subject: `Relatório Tecnomed Nº ${numero.padStart(4, "0")} - ${cliente}`,
      text: `Olá, ${cliente}.\nSegue em anexo o relatório de manutenção.\nNúmero: ${numero.padStart(4, "0")}`,
      attachments: anexos
    });

    const aceitos = new Set((info.accepted || []).map(endereco => String(endereco).toLowerCase()));
    const destinatarios = [emailCliente, ...emailsCopia()];
    if (destinatarios.some(endereco => !aceitos.has(endereco.toLowerCase()))) {
      return response.status(502).json({ accepted: false, error: "O servidor de e-mail não aceitou todos os destinatários." });
    }
    return response.json({ accepted: true, message: "Relatório aceito para envio pelo servidor de e-mail." });
  } catch (error) {
    console.error("Falha ao transmitir relatório pelo SMTP", error);
    return response.status(502).json({ accepted: false, error: "Falha no envio de e-mail. Confira a configuração SMTP do servidor." });
  }
});

app.use((error, request, response, next) => {
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return response.status(status).json({
      accepted: false,
      error: status === 413 ? "O arquivo excede o limite de 4 MB." : "Arquivo rejeitado; confira os anexos do relatório."
    });
  }
  if (error.message === "Origem não autorizada.") return response.status(403).json({ error: error.message });
  console.error("Erro na API local", error);
  return response.status(500).json({ accepted: false, error: "Erro interno ao processar o relatório." });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`API Tecnomed disponível na porta ${port}.`);
  if (!smtpConfigurado()) console.warn("SMTP não configurado. Preencha as variáveis SMTP no arquivo .env.");
});
