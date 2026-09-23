import {createPublicKey} from 'node:crypto';
import {nameOf} from '../../engine/src/common/names.ts';
import type {Mandate} from '../../engine/src/hub/mandates.ts';
import {credentialSPKI} from '../member-login/credential-key.ts';
import type {memberRuntime} from './runtime.ts';
import {grantReviewShop} from './review-shop.ts';
const DAY_MS=86_400_000;
/**
 * The terms of the version-1 mandate a newly adopted household is asked to
 * sign. They are a claim (§16.1, question 56): nothing here signs them, they
 * have no effect until the member's own passkey does, and the device shows
 * them before it signs. PRODUCTION.md gives the reason for each value.
 */
export function firstMandateClaim(household:string,at:number):Mandate{
 return {id:household+'.1',household,ceiling_out_of_network:0,ceiling_daily:null,cooling_seconds:null,co_signers:[],lapses_at:at+365*DAY_MS,version:1};
}
export class AdoptionError extends Error {}
/**
 * Decided 2026-09-23. A household is adopted at the first sign-in whose
 * assertion verified, because that is the first moment the credential has
 * proven it holds the key the household is named after (§13.2, question 55).
 * Registration alone adopts nothing: enrolment runs with attestation 'none',
 * so a registered public key is a value the client sent.
 *
 * Called from `login.finish` before its session is created, inside one
 * savepoint, so a refusal leaves no half-adopted principal. A name another
 * live principal already holds is refused, and so the sign-in is.
 *
 * Two more refusals were added the same day, from a refutation pass that
 * measured a route past both: (1) adoption itself runs only when the
 * principal holds exactly one credential, proven, and it is the one that
 * just signed in (the shape `device-acceptance.ts` `prepareStatementAcceptance`
 * already required for its own single-device acceptance); a principal
 * carrying a second, unrelated credential adopts nothing until that
 * credential is gone. (2) once a principal has adopted, every later sign-in
 * of any of its credentials is checked against the household it holds, not
 * only credentials that arrive after adoption: two invitations issued for
 * one principal before either was used could enrol two different keys, and
 * the second key's sign-in read a live session on the first key's household
 * because the session names the principal's household rather than the
 * credential's own key.
 */
export function adoptOnSignIn(r:ReturnType<typeof memberRuntime>,credentialID:string){
 r.path.transaction(()=>{
  const cose=r.login.verifiedPublicKey(credentialID);
  const claimed=r.authority.claimedPrincipalHousehold(credentialID);
  if(claimed!==undefined){
   if(!cose)throw new AdoptionError('Credential key unavailable');
   const pem=createPublicKey({key:credentialSPKI(cose),format:'der',type:'spki'}).export({type:'spki',format:'pem'}).toString();
   if(nameOf(pem)!==claimed)throw new AdoptionError('Credential key does not name this principal\'s household');
   return;
  }
  const principal=r.authority.unclaimedPrincipalOf(credentialID);
  if(!principal)return;
  const {proven,unproven}=r.authority.credentialProof(principal);
  if(proven.length!==1||unproven.length!==0||proven[0]!==credentialID)throw new AdoptionError(`Adoption requires exactly the one credential that just signed in; ${proven.length} have signed in and ${unproven.length} have not`);
  if(!cose)throw new AdoptionError('Credential key unavailable');
  const pem=createPublicKey({key:credentialSPKI(cose),format:'der',type:'spki'}).export({type:'spki',format:'pem'}).toString();
  if(r.authority.holdsHousehold(nameOf(pem)))throw new AdoptionError('Household is held by another principal');
  const household=r.authority.adoptHousehold(principal,credentialID),at=r.now();
  // The key a household's statements and mandates are checked against is registered under the household's own name.
  r.engine.registerIdentity(household,pem);
  r.engine.mandates.importMandate(firstMandateClaim(household,at),at);
  grantReviewShop(r,principal,household,at);
 })();
}
