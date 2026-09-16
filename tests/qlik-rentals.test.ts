import assert from "node:assert/strict";
import test from "node:test";
import { parseRentalInventory,rentalInventoryMapping } from "../lib/qlik-rental-inventory.ts";
import { parseRentalReceiptSnapshots,RENTAL_RECEIPTS_APP,RENTAL_RECEIPTS_SHEET,RENTAL_RECEIPTS_OBJECT } from "../lib/qlik-rental-receipts.ts";
import type { QlikMetricSnapshot } from "../lib/qlik-cloud.ts";
import { parseReceiptForm,receiptForm,receiptTotals } from "../lib/rental-receipts.ts";

test("IR mensal opcional desconta centavos sem modificar outras parcelas",()=>{
 const form={...receiptForm(),rent_received:"2500.50",administration_fee:"150.20",income_tax:"100.10"};
 assert.equal(receiptTotals(parseReceiptForm(form)).net,2250.20);
 assert.equal(parseReceiptForm({...form,income_tax:""}).income_tax,0);
 assert.throws(()=>parseReceiptForm({...form,income_tax:"-1"}));
});
test("carteira exige mapeamento validado, códigos estáveis e linhas completas",()=>{
 assert.throws(()=>rentalInventoryMapping({mapping_verified:false}),/Confirme/);
 const mapping=rentalInventoryMapping({mapping_verified:true,object_id:"table",id_column:"Cód. Imóvel",name_column:"Nome"});
 const snapshot={headers:["Cód. Imóvel","Nome"],rows:[["0007","Casa"],["7","Sala"]],selections:{}};
 assert.deepEqual(parseRentalInventory(snapshot,mapping).map(r=>r.source_id),["0007","7"]);
 assert.throws(()=>parseRentalInventory({...snapshot,rows:[...snapshot.rows,snapshot.rows[0]]},mapping),/duplicado/);
 assert.throws(()=>parseRentalInventory({...snapshot,rows:[["7"]]},mapping),/incompleta/);
 assert.throws(()=>parseRentalInventory({...snapshot,rows:[]},mapping),/vazia/);
});
const base={mode:"snapshot" as const,referenceMonth:"2026-09-01",appId:RENTAL_RECEIPTS_APP,sheetId:RENTAL_RECEIPTS_SHEET,objectId:RENTAL_RECEIPTS_OBJECT,objectTitle:"Recebido",targetLabel:"Recebido",selections:{}};
const data:QlikMetricSnapshot[]=[
 {...base,metricKey:"performance_company",value:0,companyName:"0007"},
 {...base,metricKey:"performance_company",value:0,companyName:"7"},
 {...base,metricKey:"rental_received:total",value:300.30},
 {...base,metricKey:"rental_received",value:200.10,companyName:"0007",cashDate:"2026-08-01"},
 {...base,metricKey:"rental_received",value:120.20,companyName:"0007",cashDate:"2026-08-10"},
 {...base,metricKey:"rental_received",value:-20,companyName:"7",cashDate:"2026-09-01"},
];
test("recebimentos são conciliados e agrupados por código exato e mês, incluindo estornos",()=>{
 assert.deepEqual(parseRentalReceiptSnapshots(data).rows,[{source_code:"0007",reference_month:"2026-08-01",received_amount:320.30},{source_code:"7",reference_month:"2026-09-01",received_amount:-20}]);
 assert.throws(()=>parseRentalReceiptSnapshots(data.slice(0,-1)),/divergente/);
 assert.throws(()=>parseRentalReceiptSnapshots([...data,data[3]]),/duplicado/);
 assert.throws(()=>parseRentalReceiptSnapshots(data.map((r,i)=>i===3?{...r,cashDate:null}:r)),/data válida/);
 assert.throws(()=>parseRentalReceiptSnapshots(data.map((r)=>({...r,appId:"wrong"}))),/Origem/);
});
