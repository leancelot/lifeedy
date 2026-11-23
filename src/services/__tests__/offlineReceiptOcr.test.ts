import { describe, expect, it } from 'vitest';
import {
  extractBestQrFromList,
  parseNfceQrCode,
  parseReceiptOcrText,
} from '../offlineReceiptOcr';

describe('offlineReceiptOcr.parseReceiptOcrText', () => {
  it('prioriza Valor a Pagar sobre tributos aproximados, descontos e troco em NFC-e', () => {
    const sampleReceipt = `
      DANFE NFC-e - Documento Auxiliar
      SUPERMERCADO BOM PRECO LTDA
      CNPJ: 12.345.678/0001-90
      Rua das Flores, 120 - Centro
      ARROZ INTEGRAL 5KG 29,90
      CAFE TORRADO 18,50
      SUBTOTAL 48,40
      DESCONTO 3,40
      VALOR A PAGAR R$ 45,00
      CARTAO DE CREDITO 45,00
      TROCO 0,00
      Val Aprox Tributos R$ 11,20 (Lei 12.741)
      Emissao: 14/11/2026 19:42:10
      Chave de Acesso 35261112345678000190650010000123451000123456
    `;

    const parsed = parseReceiptOcrText(sampleReceipt);
    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe('SUPERMERCADO BOM PRECO LTDA');
    expect(parsed?.amount).toBe(45);
    expect(parsed?.date).toBe('2026-11-14');
    expect(parsed?.category).toBe('alimentacao');
    expect(parsed?.paymentMethod).toBe('cartao_credito');
    expect(parsed?.notes).not.toContain('35261112345678000190650010000123451000123456');
  });

  it('reconhece data ISO e pagamento via Pix em farmácia', () => {
    const pharmacyReceipt = `
      DROGARIA SAO PAULO S.A.
      CUPOM FISCAL ELETRONICO SAT
      MEDICAMENTO GENERICO 62,40
      TOTAL 62,40
      PIX QR CODE 62,40
      2026-11-10
    `;

    const parsed = parseReceiptOcrText(pharmacyReceipt);
    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe('DROGARIA SAO PAULO S.A');
    expect(parsed?.amount).toBe(62.4);
    expect(parsed?.date).toBe('2026-11-10');
    expect(parsed?.category).toBe('saude');
    expect(parsed?.paymentMethod).toBe('pix');
  });

  it('reconhece abastecimento em posto de combustível e pagamento no débito', () => {
    const fuelReceipt = `
      AUTO POSTO IPIRANGA CENTRO
      GASOLINA COMUM 30L 185,70
      Valor Total 185,70
      Cartao Debito Visa
      12/11/2026
    `;

    const parsed = parseReceiptOcrText(fuelReceipt);
    expect(parsed).not.toBeNull();
    expect(parsed?.amount).toBe(185.7);
    expect(parsed?.category).toBe('transporte');
    expect(parsed?.paymentMethod).toBe('cartao_debito');
    expect(parsed?.date).toBe('2026-11-12');
  });

  it('retorna null para texto vazio ou ilegível sem valores', () => {
    expect(parseReceiptOcrText('')).toBeNull();
    expect(parseReceiptOcrText('   \n  ')).toBeNull();
    expect(parseReceiptOcrText('abc')).toBeNull();
  });
});

describe('offlineReceiptOcr.parseNfceQrCode', () => {
  it('extrai chave, CNPJ, valor e data hex de URL de NFC-e SEFAZ', () => {
    // 2026-11-18T14:30:00-03:00 em ASCII hex
    const hexDate = Array.from('2026-11-18T14:30:00-03:00')
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('');
    const key44 = '35261112345678000190650010000123451000123456';
    const url = `https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?chNFe=${key44}&nVersao=100&tpAmb=1&dhEmi=${hexDate}&vNF=127.45`;

    const parsed = parseNfceQrCode(url);
    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe('nfce');
    expect(parsed?.accessKey).toBe(key44);
    expect(parsed?.cnpj).toBe('12.345.678/0001-90');
    expect(parsed?.amount).toBe(127.45);
    expect(parsed?.date).toBe('2026-11-18');
  });

  it('extrai chave de 44 dígitos de QR NFC-e compacto v2', () => {
    const key44 = '41261198765432000110650020000555551000999999';
    const parsed = parseNfceQrCode(`http://www.fazenda.pr.gov.br/nfce/qrcode?p=${key44}|2|1|1|ABCDEF`);
    expect(parsed?.kind).toBe('nfce');
    expect(parsed?.accessKey).toBe(key44);
    expect(parsed?.cnpj).toBe('98.765.432/0001-10');
    expect(parsed?.notes).toContain('Emissão 2026-11');
  });

  it('decodifica QR Code Pix EMV (BRC) offline', () => {
    const pixPayload =
      '000201' +
      '26330014br.gov.bcb.pix011112345678901' +
      '52040000' +
      '5303986' +
      '540589.50' +
      '5802BR' +
      '5915PADARIA CENTRAL' +
      '6009SAO PAULO' +
      '6304ABCD';

    const parsed = extractBestQrFromList(['texto_qualquer', pixPayload]);
    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe('pix');
    expect(parsed?.title).toBe('PADARIA CENTRAL');
    expect(parsed?.amount).toBe(89.5);
    expect(parsed?.paymentMethod).toBe('pix');
    expect(parsed?.notes).toContain('SAO PAULO');
  });
});

