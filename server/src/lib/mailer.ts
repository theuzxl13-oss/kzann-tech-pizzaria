import type { FastifyBaseLogger } from 'fastify';
import nodemailer from 'nodemailer';
import type { Config } from '../config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

/**
 * Envio de e-mail via SMTP (Resend, Amazon SES, Gmail Workspace, Mailgun, servidor próprio...).
 * Sem SMTP_URL: em desenvolvimento o conteúdo vai para o log; em produção não há envio (retorna null).
 */
export function createMailer(cfg: Config, log: FastifyBaseLogger): Mailer | null {
  if (cfg.SMTP_URL) {
    const transport = nodemailer.createTransport(cfg.SMTP_URL);
    return {
      async send(msg) {
        await transport.sendMail({ from: cfg.MAIL_FROM, ...msg });
      },
    };
  }
  if (cfg.NODE_ENV !== 'production') {
    return {
      async send(msg) {
        log.info({ to: msg.to, subject: msg.subject }, `[e-mail de desenvolvimento]\n${msg.text}`);
      },
    };
  }
  return null;
}
