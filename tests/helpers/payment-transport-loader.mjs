// Test transport fixtures only. Production authorization code remains intact.
import {registerHooks} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import ts from 'typescript';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const virtual=source=>'data:text/javascript,'+encodeURIComponent(source);
registerHooks({
 resolve(specifier,context,next){
  if(specifier==='tus-js-client')return {url:virtual('export class Upload { constructor(file, options) {globalThis.__tusOptions=options; this.options=options;} start(){this.options.onSuccess();} }'),shortCircuit:true};
  if(specifier==='./supabase'&&context.parentURL?.endsWith('/lib/payment-client.ts'))return {url:virtual('export function getSupabase(){return globalThis.__paymentStorageFixture;}'),shortCircuit:true};
  if(specifier==='next/server')return {url:pathToFileURL(root+'/node_modules/next/server.js').href,shortCircuit:true};
  let path;
  if(specifier.startsWith('@/'))path=resolve(root,specifier.slice(2));
  else if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:'))path=resolve(dirname(fileURLToPath(context.parentURL)),specifier);
  if(path)for(const suffix of ['', '.ts','.tsx','.js'])if(existsSync(path+suffix)&&/\.(ts|tsx|js)$/.test(path+suffix))return {url:pathToFileURL(path+suffix).href,shortCircuit:true};
  return next(specifier,context);
 },
 load(url,context,next){
  if(url.startsWith(pathToFileURL(root+'/').href)&&/\.tsx?$/.test(url))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText};
  return next(url,context);
 }
});
