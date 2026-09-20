import {inMemoryStore, type Store} from '../common/store.js';
import {unprocessable} from '../common/errors.js';

/** A pre-order amount, never evidence that goods were placed or delivered. */
export type CarriageQuote = {offer:string; carriage:number; quoted_at:number};
export class CarriageQuotes {
  private readonly rows:Map<string,CarriageQuote>;
  constructor(store:Store=inMemoryStore()){this.rows=store.map('carriage_quotes');}
  find(offer:string):CarriageQuote|undefined {const row=this.rows.get(offer);return row?{...row}:undefined;}
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
