import test from 'node:test';
import assert from 'node:assert/strict';
import {processContext,directProcessAnswer} from '../lib/process-ai-context.ts';
import {usableProcessText} from '../lib/process-pdf-text.ts';

test('questions retain process policies, relevant steps and neighbors; broad questions keep everything',()=>{
 const process={title:'Compras',objective:'Comprar corretamente',policies:['Aprovação obrigatória']};
 const steps=Array.from({length:30},(_,i)=>({title:i===20?'Contratação especializada':`Passo ${i}`,description:'Descrição'}));
 const selected=processContext(process,steps,'Como fazer a contratação especializada?');
 assert.equal(selected.process,process);assert.deepEqual(selected.steps,steps.slice(19,22));assert.equal(selected.omitted_steps,27);
 assert.equal(processContext(process,steps,'Resuma todas as etapas').steps.length,30);
 assert.equal(processContext(process,steps,'Uma pergunta sem correspondência').steps.length,30);
 assert.equal(directProcessAnswer('Qual é o objetivo do processo?',process),'Objetivo de Compras: Comprar corretamente');
 assert.equal(directProcessAnswer('Como melhorar o objetivo?',process),null);
});

test('PDF text replaces the file only when every page is legible and has no visual information',()=>{
 const page={text:'Procedimento completo em texto. '.repeat(10),imageCount:0,drawingCount:0};
 assert.ok(usableProcessText([page])?.includes('Página 1'));
 assert.equal(usableProcessText([page,{...page,text:''}]),null);
 assert.equal(usableProcessText([{...page,imageCount:1}]),null);
 assert.equal(usableProcessText([{...page,drawingCount:11}]),null);
 assert.equal(usableProcessText([{...page,text:'x'.repeat(80001)}]),null);
});
