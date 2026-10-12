import {jsPDF} from 'jspdf';
import {autoTable} from 'jspdf-autotable';
import {salesSummary,saleExportStatus} from './sales-export-utils.js';
const money=(n,c)=>new Intl.NumberFormat('en-ZM',{style:'currency',currency:c}).format(Number(n||0));
const stamp=d=>new Date(d).toLocaleString('en-ZM',{timeZone:'Africa/Lusaka'});
export function buildSalesPdf({company,range,sales,payments,refunds,detailed=true,logo=null,generated=new Date()}){
 const doc=new jsPDF({orientation:detailed?'landscape':'portrait'}),width=doc.internal.pageSize.getWidth();const style={styles:{fontSize:8,cellPadding:2.5,overflow:'linebreak'},headStyles:{fillColor:[15,118,110]},margin:{left:12,right:12,bottom:16}};
 let x=12;if(logo){doc.addImage(logo,'PNG',12,10,18,18);x=34;}doc.setFontSize(17);doc.text(doc.splitTextToSize(company.name,width-x-12),x,16);doc.setFontSize(10);doc.text(detailed?'Sales archive - detailed report':'Sales archive - summary',12,35);doc.setFontSize(8);doc.text(`${range.from} to ${range.to} | Zambia time`,12,41);doc.text(`Generated ${stamp(generated)} | TPIN: ${company.tpin||'-'}`,12,46);
 const summaries=salesSummary(sales,payments,refunds);autoTable(doc,{...style,startY:51,head:[['Currency','Transactions','Subtotal','Discount','Tax','Sales','Refunds in period','Sales less refunds']],body:summaries.map(g=>[g.currency,g.transactions,money(g.subtotal,g.currency),money(g.discount,g.currency),money(g.tax,g.currency),money(g.sales,g.currency),money(g.refunds,g.currency),money(g.net,g.currency)])});
 autoTable(doc,{...style,startY:doc.lastAutoTable.finalY+7,head:[['Currency','Payment method','Received (cash change deducted)']],body:summaries.flatMap(g=>Object.entries(g.methods).map(([m,n])=>[g.currency,m,money(n,g.currency)]))});
 if(detailed){autoTable(doc,{...style,startY:doc.lastAutoTable.finalY+7,head:[['Receipt','Date / time','Cashier','Payment','Subtotal','Discount','Tax','Total','Refunded to date','Status']],body:sales.map(s=>[s.receipt_number,stamp(s.created_at),s.cashier_name,s.payment_method,money(s.subtotal,s.currency),money(s.discount,s.currency),money(s.tax,s.currency),money(s.total,s.currency),money(s.refunded_total,s.currency),saleExportStatus(s)])});}
 if(refunds.length)autoTable(doc,{...style,startY:doc.lastAutoTable.finalY+7,head:[['Refund','Original receipt','Refund date','Payment','Amount']],body:refunds.map(r=>[r.number,r.receipt_number,stamp(r.created_at),r.payment_method,money(r.total,r.currency)])});
 const count=doc.getNumberOfPages();for(let i=1;i<=count;i++){doc.setPage(i);doc.setFontSize(7);doc.text('Sales use sale date; refunds use refund date. Status/refunded-to-date reflect export time. Not a ZRA filing.',12,doc.internal.pageSize.getHeight()-10);doc.text(`Page ${i} of ${count}`,width-32,doc.internal.pageSize.getHeight()-5);}
 return doc;
}
