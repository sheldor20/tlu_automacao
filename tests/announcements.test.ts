import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, projectDatabase } from './helpers/project-database.ts';
import { announcementSchema, announcementAction } from '../lib/announcement-schema.ts';
test('mural: validação de conteúdo e ações',()=>{
 assert.equal(announcementSchema.safeParse({title:'Aviso',body:''}).success,false);
 assert.equal(announcementSchema.safeParse({title:'Aviso',body:'Comunicado do RH'}).success,true);
 assert.equal(announcementSchema.safeParse({title:'Aviso',body:'',media_path:'https://externo/imagem.svg'}).success,false);
 assert.equal(announcementAction.safeParse({action:'permission',user_id:'invalido',can_publish:true}).success,false);
 assert.equal(announcementAction.safeParse({action:'react',post_id:'11111111-1111-4111-8111-111111111111',reaction:'👍'}).success,true);
});
test('mural: banco privado, limites, reação única e exclusão em cascata',async t=>{
 const db=await projectDatabase();t.after(()=>db.close());
 await migrate(db,'20261029184637_announcement_wall.sql');
 const uid='11111111-1111-4111-8111-111111111111';
 await db.query('insert into auth.users(id,email) values($1,$2)',[uid,'mural@test.invalid']);
 const p=(await db.query<{id:string}>("insert into announcements(author_id,author_name,title,body) values($1,'Teste','Aviso','Corpo') returning id",[uid])).rows[0].id;
 for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);for(const table of ['announcements','announcement_comments','announcement_reactions','announcement_publishers'])await assert.rejects(()=>db.query(`select * from ${table}`),/permission denied/);await db.exec('reset role');}
 await db.query("insert into announcement_comments(post_id,author_id,author_name,body) values($1,$2,'Teste','Comentário')",[p,uid]);
 await assert.rejects(()=>db.query("insert into announcement_comments(post_id,author_id,author_name,body) values($1,$2,'Teste','')",[p,uid]),/check constraint/);
 await db.query("insert into announcement_reactions values($1,$2,'👍')",[p,uid]);
 await assert.rejects(()=>db.query("insert into announcement_reactions values($1,$2,'❤️')",[p,uid]),/unique/);
 await db.query('delete from announcements where id=$1',[p]);
 assert.equal((await db.query('select * from announcement_comments')).rows.length,0);
 assert.equal((await db.query('select * from announcement_reactions')).rows.length,0);
 const bucket=(await db.query<{public:boolean}>("select public from storage.buckets where id='announcement-media'")).rows[0];assert.equal(bucket.public,false);
});
