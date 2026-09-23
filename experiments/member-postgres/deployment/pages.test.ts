import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
const page=(name:string)=>readFileSync(new URL('./production/'+name,import.meta.url),'utf8');
const text=(html:string)=>html.replace(/<[^>]+>/g,'').replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#x27;',"'");
// The founder filled the draft's placeholders on 2026-09-23. A page served to App Review with one left in
// reads as unfinished, so the build must not carry any: a square bracket is how the draft marks one.
test('neither App Store page carries a square-bracket placeholder',()=>{
 for(const name of ['privacy.html','support.html'])expect(text(page(name))).not.toMatch(/\[[^\]]*\]/);
});
test('the pages carry the facts the founder supplied',()=>{
 const privacy=text(page('privacy.html')),support=text(page('support.html'));
 expect(privacy).toContain('Effective 23 September 2026.');
 expect(privacy).toContain('Vox Japan K.K. (5-5-15 Kitashinagawa, Shinagawa, Tokyo 141-0001, Japan');
 expect(privacy).toContain('representative Yoichiro Hara');
 expect(privacy).toContain("Transfers outside Japan. Our database is stored in Singapore by Neon, a service of Databricks, Inc. (United States). Our service runs on Vercel Inc. (United States) in its Singapore region, and Vercel also processes data in the United States. Apple Inc. (United States) delivers push notifications. Singapore has a comprehensive personal data protection law, the Personal Data Protection Act 2012. The United States has no comprehensive federal law on personal information; protection rests on laws for particular sectors and on the laws of individual states. The Personal Information Protection Commission publishes a summary of both systems at https://www.ppc.go.jp/personalinfo/legal/kaiseihogohou/#gaikoku. Vercel processes the data under a data processing addendum that limits it to our instructions, and Neon under Databricks' terms for the Neon platform, which set out its security measures.");
 expect(page('privacy.html')).toContain('<a href="https://www.ppc.go.jp/personalinfo/legal/kaiseihogohou/#gaikoku">');
 for(const t of [privacy,support])expect(t).toContain('support@vox.delivery');
});
