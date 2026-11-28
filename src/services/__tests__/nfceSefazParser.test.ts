import { describe, expect, it } from 'vitest';
import {
  extractNfceFallbackFromOcrText,
  extractNfceKeyOrUrl,
  inferCategoryFromTextAndCnae,
  isAllowedSefazUrl,
  parseSefazHtmlToReceipt,
} from '../nfceSefazParser';

describe('nfceSefazParser', () => {
  describe('isAllowedSefazUrl', () => {
    it('aceita URLs oficiais dos portais estaduais da SEFAZ / Fazenda (.gov.br)', () => {
      const validUrls = [
        'https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=35261147508411000156650010001234561000123456|2|1|1|HASH',
        'https://nfce.fazenda.rj.gov.br/consulta?p=33261147508411000156650010001234561000123456|2|1|1|HASH',
        'https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml?p=31261147508411000156650010001234561000123456',
        'https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx?p=43261147508411000156650010001234561000123456',
        'http://www.fazenda.pr.gov.br/nfce/qrcode?p=41261147508411000156650010001234561000123456',
        'http://app.sefaz.es.gov.br/ConsultaNFCe?p=32261166427271000136650010000315861000316865',
        'https://dfe-portal.svrs.rs.gov.br/Dfe/QrCodeNFce?p=23261147508411000156650010001234561000123456',
      ];

      for (const url of validUrls) {
        const res = isAllowedSefazUrl(url);
        expect(res.ok, `Esperava aceitar URL oficial: ${url}`).toBe(true);
      }
    });

    it('bloqueia URLs externas, IPs privados, localhost, portas incomuns e credenciais (anti-SSRF)', () => {
      const blockedUrls = [
        '',
        'http://localhost:3000/nfce',
        'http://127.0.0.1/nfce',
        'http://169.254.169.254/latest/meta-data',
        'https://evil.com/fazenda.sp.gov.br/nfce',
        'https://www.google.com/nfce',
        'https://user:pass@www.nfce.fazenda.sp.gov.br/consulta',
        'https://www.nfce.fazenda.sp.gov.br:8443/consulta',
        'javascript:alert(1)',
        'https://portal.fazenda.sp.gov.br.attacker.com/nfce',
      ];

      for (const url of blockedUrls) {
        const res = isAllowedSefazUrl(url);
        expect(res.ok, `Esperava bloquear URL insegura: ${url}`).toBe(false);
      }
    });
  });

  describe('extractNfceKeyOrUrl', () => {
    it('extrai chave de 44 dígitos e CNPJ a partir de URL NFC-e', () => {
      const url =
        'https://www.nfce.fazenda.sp.gov.br/qrcode?p=35261147508411000156650010001234561000123456|2|1|1|ABC';
      const extracted = extractNfceKeyOrUrl(url);
      expect(extracted.sefazUrl).toBe(url);
      expect(extracted.accessKey).toBe('35261147508411000156650010001234561000123456');
      expect(extracted.cnpj).toBe('47.508.411/0001-56');
      expect(extracted.qrParsed?.kind).toBe('nfce');
    });

    it('extrai chave de 44 dígitos mesmo quando colada com espaços ou hifens', () => {
      const rawKey = '3526 1147 5084 1100 0156 6500 1000 1234 5610 0012 3456';
      const extracted = extractNfceKeyOrUrl(rawKey);
      expect(extracted.sefazUrl).toBeUndefined();
      expect(extracted.accessKey).toBe('35261147508411000156650010001234561000123456');
      expect(extracted.cnpj).toBe('47.508.411/0001-56');
    });

    it('reconhece payload Pix EMV estático/dinâmico', () => {
      const pix =
        '00020126360014br.gov.bcb.pix0114+5511999999999520400005303986540542.505802BR5915PADARIA CENTRAL6009SAO PAULO6304ABCD';
      const extracted = extractNfceKeyOrUrl(pix);
      expect(extracted.qrParsed?.kind).toBe('pix');
      expect(extracted.qrParsed?.title).toBe('PADARIA CENTRAL');
      expect(extracted.qrParsed?.amount).toBe(42.5);
      expect(extracted.qrParsed?.paymentMethod).toBe('pix');
    });
  });

  describe('parseSefazHtmlToReceipt', () => {
    it('extrai estabelecimento, CNPJ, itens, valor total, data e pagamento de HTML padrão SEFAZ/SVRS', () => {
      const sampleHtml = `
        <html>
          <body>
            <div class="txtCenter">
              <div id="u20" class="txtTopo">SUPERMERCADO BOM PREÇO LTDA</div>
              <div class="text">CNPJ: 47.508.411/0001-56</div>
            </div>
            <table id="tabResult">
              <tr><td><span class="txtTit">ARROZ TIPO 1 5KG</span> (Código: 101)</td></tr>
              <tr><td><span class="txtTit">CAFE TORRADO 500G</span> (Código: 202)</td></tr>
            </table>
            <div id="totalNota">
              <div><label>Valor a pagar R$:</label><span class="totalNumb txtMax">187,45</span></div>
              <div><label>Forma de pagamento:</label><span>Cartão de Débito</span></div>
            </div>
            <div>Emissão: 23/11/2026 14:32:10</div>
          </body>
        </html>
      `;

      const parsed = parseSefazHtmlToReceipt(sampleHtml);
      expect(parsed.captchaBlocked).toBe(false);
      expect(parsed.title).toBe('SUPERMERCADO BOM PREÇO LTDA');
      expect(parsed.cnpj).toBe('47.508.411/0001-56');
      expect(parsed.amount).toBe(187.45);
      expect(parsed.date).toBe('2026-11-23');
      expect(parsed.paymentMethod).toBe('cartao_debito');
      expect(parsed.items).toEqual(['ARROZ TIPO 1 5KG', 'CAFE TORRADO 500G']);
    });

    it('detecta página bloqueada por CAPTCHA e preserva CNPJ/fallback do QR', () => {
      const captchaHtml = `
        <html>
          <body>
            <form>
              <div class="g-recaptcha" data-sitekey="xyz"></div>
              <p>Valide o captcha para visualizar o documento fiscal.</p>
            </form>
          </body>
        </html>
      `;

      const parsed = parseSefazHtmlToReceipt(captchaHtml, {
        kind: 'nfce',
        cnpj: '47.508.411/0001-56',
        amount: 95.3,
        date: '2026-11-22',
      });

      expect(parsed.captchaBlocked).toBe(true);
      expect(parsed.cnpj).toBe('47.508.411/0001-56');
      expect(parsed.amount).toBe(95.3);
      expect(parsed.date).toBe('2026-11-22');
    });
  });

  describe('inferCategoryFromTextAndCnae', () => {
    it('classifica corretamente CNAEs da Receita Federal e nomes comerciais', () => {
      expect(
        inferCategoryFromTextAndCnae('Comércio varejista de mercadorias em geral, com predominância de produtos alimentícios - hipermercados')
      ).toBe('alimentacao');
      expect(
        inferCategoryFromTextAndCnae('Comércio varejista de carnes - açougues')
      ).toBe('alimentacao');
      expect(inferCategoryFromTextAndCnae('Comércio varejista de combustíveis para veículos automotores')).toBe('transporte');
      expect(inferCategoryFromTextAndCnae('Comércio varejista de produtos farmacêuticos, sem manipulação de fórmulas')).toBe('saude');
      expect(inferCategoryFromTextAndCnae('Comércio varejista de materiais de construção em geral')).toBe('moradia');
    });
  });

  describe('extractNfceFallbackFromOcrText', () => {
    it('extrai chave de 44 dígitos espaçada e CNPJ a partir de texto OCR de cupom fiscal', () => {
      const ocrText = `
        Consulte pela Chave de Acesso em
        http://app.sefaz.es.gov.br/ConsultaNFCe
        3226 1166 4272 7100 0136 6500 1000 0315 8610 0031 6865
        CONSUMIDOR NAO IDENTIFICADO
      `;
      const extracted = extractNfceFallbackFromOcrText(ocrText);
      expect(extracted.accessKey).toBe('32261166427271000136650010000315861000316865');
      expect(extracted.cnpj).toBe('66.427.271/0001-36');
    });
  });
});
