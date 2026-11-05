// Creates only local test files. It does not start Next.js, Chrome or a deployment.
import { mkdir, readFile, writeFile, symlink, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const target=join(root,'.local','distratos-multi-harness');
await mkdir(join(target,'app','distratos'),{recursive:true});
for(const name of ['lib','components','public','node_modules']){
 const link=join(target,name);
 try {await lstat(link);} catch(e){if(e.code!=='ENOENT')throw e;await symlink(join(root,name),link);}
}
await writeFile(join(target,'package.json'),JSON.stringify({name:'distratos-multi-local-harness',private:true,scripts:{dev:'next dev --webpack --hostname 127.0.0.1 -p 3137'}},null,2));
await writeFile(join(target,'tsconfig.json'),await readFile(join(root,'tsconfig.json')));
await writeFile(join(target,'app','layout.tsx'),`import ${JSON.stringify(resolve(root,'app/globals.css'))};\nexport default function Layout({children}:{children:React.ReactNode}) {return <html lang="pt-BR"><body>{children}</body></html>;}\n`);
await writeFile(join(target,'app','distratos','page.tsx'),`export {default} from ${JSON.stringify(resolve(root,'app/(app)/distratos/page'))};\n`);
console.log(target);
