import { describe, it, expect } from 'vitest';
import { buildImportKeys, parseAmountCell, parseDateCell, parseStatement, splitCsvLine } from './statement';

describe('parseDateCell / parseAmountCell', () => {
  it('いろいろな日付表記を YYYY-MM-DD にする', () => {
    expect(parseDateCell('2026/11/09')).toBe('2026-11-09');
    expect(parseDateCell('2026-1-5')).toBe('2026-01-05');
    expect(parseDateCell('2026年11月9日')).toBe('2026-11-09');
    expect(parseDateCell('26/11/09')).toBe('2026-11-09');
    expect(parseDateCell('2026/11/09 12:34')).toBe('2026-11-09');
    expect(parseDateCell('２０２６／１１／０９')).toBe('2026-11-09');
    expect(parseDateCell('1回払い')).toBeNull();
    expect(parseDateCell('1234')).toBeNull();
  });
  it('金額の表記ゆれを吸収し、数値でないものは null', () => {
    expect(parseAmountCell('1,234')).toBe(1234);
    expect(parseAmountCell('¥1,234')).toBe(1234);
    expect(parseAmountCell('1234円')).toBe(1234);
    expect(parseAmountCell('１，２３４')).toBe(1234);
    expect(parseAmountCell('-500')).toBe(-500);
    expect(parseAmountCell('△500')).toBe(-500);
    expect(parseAmountCell('')).toBeNull();
    expect(parseAmountCell('セブン-イレブン')).toBeNull();
  });
  it('引用符付き CSV を分割する', () => {
    expect(splitCsvLine('2026/11/01,"AMAZON.CO.JP, TOKYO",1,234', ',')).toEqual(['2026/11/01', 'AMAZON.CO.JP, TOKYO', '1', '234']);
    expect(splitCsvLine('a\t"b ""c"""\td', '\t')).toEqual(['a', 'b "c"', 'd']);
  });
});

describe('parseStatement', () => {
  it('ヘッダー無し・Shift_JIS 由来の三井住友（Vpass）風 CSV を読む', () => {
    const text = [
      '2026/10/03,ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ 林寺店,680,１回払い,,680,',
      '2026/10/05,NETFLIX.COM,1490,１回払い,,1490,',
      '2026/10/07,AMAZON.CO.JP,3980,１回払い,,3980,',
      '2026/10/09,ｱﾏｿﾞﾝ ﾍﾝｷﾝ,-1200,１回払い,,-1200,',
    ].join('\r\n');
    const p = parseStatement(text);
    expect(p.columns).toEqual({ date: 0, merchant: 1, amount: 2 });
    expect(p.rows).toHaveLength(4);
    expect(p.rows[0]).toMatchObject({ date: '2026-10-03', merchant: 'ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ 林寺店', amount: 680 });
    expect(p.rows[3].amount).toBe(-1200);
    expect(p.unparsed).toBe(0);
  });

  it('ヘッダー付きで「利用金額」と「お支払い金額」があるときは利用金額を取る', () => {
    const text = [
      'ご利用日,ご利用店名,ご利用金額,支払区分,今回回数,お支払い金額,備考',
      '2026/10/03,ヨドバシカメラ,60000,分割3回,1,20300,',
      '合計,,60000,,,20300,',
    ].join('\n');
    const p = parseStatement(text);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({ merchant: 'ヨドバシカメラ', amount: 60000 });
  });

  it('明細ページをコピーしたタブ区切りテキストを読み、合計行を捨てる', () => {
    const text = [
      '利用日\t利用店名\t利用金額',
      '2026/11/01\tスターバックス\t¥590',
      '2026/11/02\tJR東日本モバイルSuica\t¥3,000',
      '合計\t\t¥3,590',
    ].join('\n');
    const p = parseStatement(text);
    expect(p.delimiter).toBe('\t');
    expect(p.rows.map((r) => r.amount)).toEqual([590, 3000]);
  });

  it('日付が2列あるときはヘッダーの「利用日」を優先する', () => {
    const text = [
      '利用日,お支払日,内容,金額',
      '2026/10/28,2026/11/26,Spotify,980',
    ].join('\n');
    const p = parseStatement(text);
    expect(p.rows[0]).toMatchObject({ date: '2026-10-28', merchant: 'Spotify', amount: 980 });
  });

  it('日付の無いテキストは読めない', () => {
    const p = parseStatement('これは明細ではありません\nただのメモ');
    expect(p.rows).toHaveLength(0);
    expect(p.columns).toBeNull();
  });
});

describe('buildImportKeys', () => {
  it('同日同店同額は連番で区別し、それ以外は安定したキーになる', () => {
    const rows = [
      { date: '2026-10-03', merchant: 'セブン', amount: 100, raw: '' },
      { date: '2026-10-03', merchant: 'セブン', amount: 100, raw: '' },
      { date: '2026-10-04', merchant: 'セブン', amount: 100, raw: '' },
    ];
    const keys = buildImportKeys('三井住友', rows);
    expect(keys[0]).toBe('card:三井住友:2026-10-03:セブン:100');
    expect(keys[1]).toBe('card:三井住友:2026-10-03:セブン:100#2');
    expect(keys[2]).toBe('card:三井住友:2026-10-04:セブン:100');
    expect(buildImportKeys('三井住友', rows)).toEqual(keys);
  });
});
