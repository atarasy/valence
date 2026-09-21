import {inMemoryStore, type Store} from '../common/store.js';
import {unprocessable} from '../common/errors.js';

/** A pre-order amount, never evidence that goods were placed or delivered. */
export type CarriageQuote = {offer:string; carriage:number; quoted_at:number};
export class CarriageQuotes {
  private readonly rows:Map<string,CarriageQuote>;
  constructor(store:Store=inMemoryStore()){this.rows=store.map('carriage_quotes');}
  find(offer:string):CarriageQuote|undefined {const row=this.rows.get(offer);return row?{...row}:undefined;}
  forOffers(offers: string[]): CarriageQuote[] { return offers.flatMap(id => { const row = this.find(id); return row ? [row] : []; }); }
  checkRows(rows: CarriageQuote[]): void {
    const seen = new Set<string>();
    for (const row of rows) {
      if (!row || Object.keys(row).sort().join(',') !== 'carriage,offer,quoted_at' || typeof row.offer !== 'string' || !row.offer || !row.offer.isWellFormed() || seen.has(row.offer) || !Number.isSafeInteger(row.carriage) || row.carriage < 0 || !Number.isSafeInteger(row.quoted_at) || row.quoted_at < 0) throw unprocessable('bad_carriage_quote', 'invalid or duplicate quotation');
      seen.add(row.offer);
      const held = this.find(row.offer);
      if (held && (held.carriage !== row.carriage || held.quoted_at !== row.quoted_at)) throw unprocessable('carriage_fixed', 'an imported quotation cannot replace a held one');
    }
  }
  importRows(rows: CarriageQuote[]): void { this.checkRows(rows); for (const row of rows) if (!this.rows.has(row.offer)) this.rows.set(row.offer, {...row}); }
  record(offer:string,carriage:number,now:number):CarriageQuote {
    if(!Number.isSafeInteger(carriage)||carriage<0)throw unprocessable('bad_carriage','carriage must be a nonnegative safe whole number');
    if(!Number.isSafeInteger(now)||now<0)throw unprocessable('bad_quote_time','invalid quotation time');
    const held=this.rows.get(offer);
    if(held){
      if(held.carriage!==carriage)throw unprocessable('carriage_fixed','the amount already shown cannot be replaced');
      return {...held};
    }
    const row={offer,carriage,quoted_at:now};this.rows.set(offer,row);return {...row};
  }
}
