// Languages for the cashier screens. English text is the key; each entry is [Bemba, Nyanja].
// To correct a translation, change the text here. Missing entries fall back to English.
// Receipts, invoices and reports stay in English.

export const LANGUAGES = [
  { code: 'en', name: 'English', html: 'en' },
  { code: 'bem', name: 'Ichibemba', html: 'bem' },
  { code: 'nya', name: 'Chinyanja', html: 'ny' },
];

export const PHRASES = {
  // ---- menu and general
  'Point of Sale': ["Pa kushitishisha", "Pogulitsira"],
  'Inventory & Suppliers': ["Ifintu fya mu shopu", "Katundu wa m'sitolo"],
  'Management': ["Ukutungulula", "Kayendetsedwe"],
  'Cashier Checkout': ["Ukushitisha", "Kugulitsa"],
  'Sales History': ["Ifyo mwashitishe", "Zomwe mwagulitsa"],
  'Receipts': ["Amarisiti", "Malisiti"],
  'Cashier Shifts': ["Ama-shift", "Ma-shift"],
  'Customers': ["Bakasita", "Makasitomala"],
  'Product Catalog': ["Ifintu fyonse", "Katundu yense"],
  'My Profile': ["Ifya kwandi", "Zanga"],
  'Getting Started & Help': ["Ubwafwilisho", "Thandizo"],
  'Sign out': ["Fumamo", "Tulukani"],
  'Lock': ["Isaleni", "Tsekani"],
  'Language': ["Ululimi", "Chilankhulo"],
  'RETAIL OPERATIONS': ["IFYA MU SHOPU", "ZA M'SITOLO"],
  'No records yet': ["Tapalaba ifyalembwa", "Palibe zolembedwa pano"],
  'STORE WORKSPACE': ["SHOPU", "SITOLO"],
  'Workspace': ["Shopu", "Sitolo"],
  'Refresh': ["Bwekeshapo", "Tsitsimutsani"],
  'Close': ["Isala", "Tsekani"],
  'Done': ["Napwisha", "Ndamaliza"],
  'Saving…': ["Tulesunga…", "Tikusunga…"],
  'Language for these screens. Receipts stay in English.': ["Ululimi lwa iyi app. Amarisiti yalaba mu Cingeleshi.", "Chilankhulo cha app iyi. Malisiti amakhala mu Chingerezi."],

  // ---- point of sale
  'Point of sale': ["Ukushitisha", "Kugulitsa"],
  'A simple checkout for every customer.': ["Shitishisheni kasita onse bwangu bwangu.", "Gulitsani kwa kasitomala aliyense mosavuta."],
  'Open / close shift': ["Isula / isala shift", "Tsegulani / tsekani shift"],
  'Offline mode.': ["Tapali intaneti.", "Palibe intaneti."],
  'Using products saved on this device at {time}. Sales are saved here and sync automatically.': ["Ifintu mulemona fyasungilwe pali ici cipe pa {time}. Ifyo mushitisha filesungwa pano kabili fikatumwa fyeka nga intaneti yabwela.", "Katundu mukuona anasungidwa pa chipangizo ichi nthawi {time}. Zomwe mugulitsa zikusungidwa pano ndipo zidzatumizidwa zokha intaneti ikabwera."],
  'Checking your cashier shift…': ["Tulemona shift yenu…", "Tikuyang'ana shift yanu…"],
  'Open your own cashier shift before starting a sale, including when selling as Director or Supervisor.': ["Isuleni shift yenu ilyo tamulatendeka ukushitisha, nangu ni mwe Director nangu Supervisor.", "Tsegulani shift yanu musanayambe kugulitsa, ngakhale mutakhala Director kapena Supervisor."],
  'Open shift': ["Isuleni shift", "Tsegulani shift"],
  'Check again': ["Moneni nakabili", "Onaninso"],
  'Search products, SKU or scan a barcode…  (F2)': ["Fwayeni icintu, SKU nangu skanani barcode…  (F2)", "Sakani katundu, SKU kapena sikanani barcode…  (F2)"],
  'Search products or scan a barcode': ["Fwayeni icintu nangu skanani barcode", "Sakani katundu kapena sikanani barcode"],
  'Scan': ["Skanani", "Sikanani"],
  'Scan with camera': ["Skanani na kamera", "Sikanani ndi kamera"],
  'Scan items': ["Skanani ifintu", "Sikanani katundu"],
  'All products': ["Ifintu fyonse", "Katundu yense"],
  '{n} products': ["Ifintu {n}", "Katundu {n}"],
  'Loading products…': ["Ifintu filefika…", "Katundu akubwera…"],
  '{n} options': ["Imisango {n}", "Mitundu {n}"],
  'from {price}': ["ukutula pa {price}", "kuyambira {price}"],
  'Expired stock': ["Fyapwa inshita", "Zatha nthawi"],
  'Out of stock': ["Fyapwa", "Zatha"],
  '{n} in stock': ["{n} filipo", "{n} zilipo"],
  'Low stock': ["Fyashala finono", "Zatsala pang'ono"],
  'In stock': ["Filipo", "Zilipo"],
  'No products found': ["Tapasangilwe icintu", "Palibe chapezeka"],
  'No products yet': ["Tapalaba ifintu", "Palibe katundu panobe"],
  'Try a different name or product code.': ["Eseshenipo ishina limbi nangu code imbi.", "Yesani dzina lina kapena code ina."],
  'Your store products will appear here.': ["Ifintu fya mu shopu yenu fikamoneka pano.", "Katundu wa sitolo yanu adzaonekera pano."],
  'Current sale': ["Ukushitisha kwa nomba", "Malonda apano"],
  'Clear': ["Fumyeni fyonse", "Chotsani zonse"],
  '{price} each': ["{price} cimo cimo", "{price} chilichonse"],
  'Your cart is empty': ["Tapalaba icintu", "Palibe katundu"],
  'Select a product to start a sale.': ["Saleni icintu pa kutendeka ukushitisha.", "Sankhani katundu kuti muyambe kugulitsa."],
  'Converting accepted quotation': ["Ukwalula quotation iyasuminwa", "Kusintha quotation yovomerezedwa"],
  'Subtotal': ["Pamo (ukwabula umusonko)", "Zonse (popanda msonkho)"],
  'Tax': ["Umusonko", "Msonkho"],
  'Discount': ["Ukucefyako", "Kuchepetsa"],
  'Total': ["Fyonse pamo", "Zonse pamodzi"],
  'Payment method': ["Inshila ya kulipila", "Njira yolipirira"],
  'Customer credit (pay later)': ["Inkongole (alalipila pa numa)", "Ngongole (adzalipira pambuyo)"],
  'Mixed payment': ["Ukulipila mu nshila ishingi", "Kulipira m'njira zosiyanasiyana"],
  'Amount paid': ["Indalama shalipilwa", "Ndalama zolipidwa"],
  "{amount} will be added to {name}'s balance.": ["{amount} shikalundwa pa nkongole ya {name}.", "{amount} zidzawonjezedwa pa ngongole ya {name}."],
  'Choose a saved customer above.': ["Saleni kasita uwasungwa pa muulu.", "Sankhani kasitomala wosungidwa pamwambapa."],
  'Confirm payment on your mobile money app or card terminal first. iPOS records the payment; it does not charge the customer.': ["Moneni ukuti indalama shafika pa mobile money nangu pa card machine. iPOS ilemba fye ukulipila; taipoka indalama kuli kasita.", "Tsimikizani kaye kuti ndalama zafika pa mobile money kapena pa makina a khadi. iPOS imangolemba malipiro; sitenga ndalama kwa kasitomala."],
  'Saving your sale…': ["Tulesunga ukushitisha…", "Tikusunga malonda…"],
  'Checking your shift…': ["Tulemona shift yenu…", "Tikuyang'ana shift yanu…"],
  'Could not check your shift. Use Check again.': ["Twafilwa ukumona shift yenu. Kanikeni \"Moneni nakabili\".", "Talephera kuona shift yanu. Dinani \"Onaninso\"."],
  'Open your own shift to enable checkout.': ["Isuleni shift yenu pa kuti mushitishe.", "Tsegulani shift yanu kuti mugulitse."],
  'Add a product to enable checkout.': ["Lundeni icintu pa kuti mushitishe.", "Onjezani katundu kuti mugulitse."],
  'Choose a saved customer for a credit sale.': ["Saleni kasita uwasungwa pa kushitisha kwa nkongole.", "Sankhani kasitomala wosungidwa pogulitsa pa ngongole."],
  "Complete the sale to add it to the customer's balance.": ["Pwisheni ukushitisha pa kulunda pa nkongole ya kasita.", "Malizani kugulitsa kuti ziwonjezedwe pa ngongole ya kasitomala."],
  'Enter the amount received, then complete the sale.': ["Lembeni indalama mwapoka, lyena pwisheni ukushitisha.", "Lembani ndalama zomwe mwalandira, kenako malizani kugulitsa."],
  'Processing checkout…': ["Tulepwisha…", "Tikumaliza…"],
  'Complete sale': ["Pwisheni ukushitisha", "Malizani kugulitsa"],
  'Stock and totals verified at checkout': ["Ifintu ne ndalama filapimwa ilyo mulepwisha", "Katundu ndi ndalama zimatsimikiziridwa pomaliza"],
  'Search': ["Fwayeni", "Sakani"],
  'Amount': ["Indalama", "Ndalama"],
  'Open your shift before adding products.': ["Isuleni shift ilyo tamulalunda ifintu.", "Tsegulani shift musanawonjeze katundu."],
  'Not enough stock for {name}.': ["{name} tafikwanine.", "{name} sizikukwanira."],
  'Product not found. Check the barcode or product code.': ["Icintu tacasangwa. Moneni barcode nangu code.", "Katundu sanapezeke. Onani barcode kapena code."],
  'Open your own cashier shift before completing a sale.': ["Isuleni shift yenu ilyo tamulapwisha ukushitisha.", "Tsegulani shift yanu musanamalize kugulitsa."],
  'Please wait, saving the sale…': ["Lindileni, tulesunga…", "Dikirani, tikusunga…"],
  'No product has barcode {code}.': ["Tapali icintu cakwata barcode {code}.", "Palibe katundu ali ndi barcode {code}."],
  '{name} added · {n} in cart': ["{name} nacilundwa · {n} pa kushitisha", "{name} wawonjezedwa · {n} pa malonda"],
  'No internet. Sale saved on this device and will sync automatically.': ["Tapali intaneti. Ukushitisha kwasungwa pali ici cipe kabili kukatumwa kweka.", "Palibe intaneti. Malonda asungidwa pa chipangizo ichi ndipo adzatumizidwa okha."],
  'Sale completed.': ["Ukushitisha kwapwa.", "Malonda atha bwino."],
  "Sale completed. {amount} added to {name}'s balance.": ["Ukushitisha kwapwa. {amount} shalundwa pa nkongole ya {name}.", "Malonda atha. {amount} zawonjezedwa pa ngongole ya {name}."],
  'Sale completed successfully. Open Receipts to print it.': ["Ukushitisha kwapwa bwino. Iseni ku Marisiti pa kuprinta.", "Malonda atha bwino. Pitani ku Malisiti kuti musindikize."],
  'You are offline. Open your shift while online before selling offline.': ["Tapali intaneti. Isuleni shift ilyo intaneti ilipo pa kuti mushitishe kwabula intaneti.", "Palibe intaneti. Tsegulani shift intaneti ilipo kuti mugulitse popanda intaneti."],
  'Choose the branch you are selling at. Stock and your shift are per branch.': ["Saleni branchi mulefwaya ukushitishishako. Ifintu na shift fyaba pa branchi imo imo.", "Sankhani nthambi imene mukugulitsira. Katundu ndi shift zili pa nthambi iliyonse."],
  'Your open shift is at {branch}. Switch to that branch at the top of the screen, or close that shift first.': ["Shift yenu iyaisuka ili ku {branch}. Alulukeni ku branchi iyo pa muulu, nangu isaleni shift iyo.", "Shift yanu yotsegula ili ku {branch}. Sinthani kupita ku nthambiyo pamwamba, kapena tsekani shift imeneyo kaye."],

  // ---- choosing a size or colour
  'has expired stock': ["fimo fyapwa inshita", "zina zatha nthawi"],
  'all in cart': ["fyonse fyaba pa kushitisha", "zonse zili pa malonda"],
  'out of stock': ["fyapwa", "zatha"],
  '{n} left': ["{n} fyashala", "{n} zatsala"],

  // ---- customer at checkout
  'Customer (optional)': ["Kasita (nga mulefwaya)", "Kasitomala (ngati mukufuna)"],
  'Search name or phone, or type a new name': ["Fwayeni ishina nangu namba ya foni, nangu lembeni ishina ilipya", "Sakani dzina kapena nambala ya foni, kapena lembani dzina latsopano"],
  'Phone (optional)': ["Foni (nga mulefwaya)", "Foni (ngati mukufuna)"],
  'No phone': ["Tapali foni", "Palibe foni"],
  'owes {amount}': ["alikwata inkongole ya {amount}", "ali ndi ngongole ya {amount}"],
  'limit {amount}': ["impela {amount}", "malire {amount}"],
  'At or over their credit limit': ["Nafika pa mpela ya nkongole", "Wafika pa malire a ngongole"],
  'Selling on credit': ["Mulemushitishisha pa nkongole", "Mukugulitsa pa ngongole"],
  'Sell on credit (pay later)': ["Shitishisheni pa nkongole (alalipila pa numa)", "Gulitsani pa ngongole (adzalipira pambuyo)"],
  'Save "{name}" as a new customer': ["Sungeni \"{name}\" nga kasita mupya", "Sungani \"{name}\" ngati kasitomala watsopano"],
  'Customer saved.': ["Kasita asungwa.", "Kasitomala wasungidwa."],
  'Choose or save a customer to sell on credit.': ["Saleni nangu sungeni kasita pa kushitisha pa nkongole.", "Sankhani kapena sungani kasitomala kuti mugulitse pa ngongole."],
  "Type the customer's name, then their phone below.": ["Lembeni ishina lya kasita, lyena namba ya foni pa nshi.", "Lembani dzina la kasitomala, kenako nambala ya foni pansipa."],

  // ---- receipts and sales
  'Sale receipt': ["Risiti", "Risiti"],
  'Print receipt': ["Printeni risiti", "Sindikizani risiti"],
  'Preparing…': ["Tulepekanya…", "Tikukonza…"],
  'Generating receipt…': ["Tulepekanya risiti…", "Tikukonza risiti…"],
  'Find a receipt, print it, or save it as a PDF.': ["Fwayeni risiti, printeni, nangu isungeni nga PDF.", "Sakani risiti, sindikizani, kapena isungeni ngati PDF."],
  'Transaction Archives & Audit Trail': ["Ifyo mwashitishe", "Zomwe mwagulitsa"],
  'Review recorded cashier activity, historical sales, taxes, and receipts.': ["Moneni ifyo mwashitishe kale, imisonko na marisiti.", "Onani malonda akale, misonkho ndi malisiti."],
  'All Transactions': ["Fyonse", "Zonse"],
  'Today Only': ["Lelo fye", "Lero lokha"],
  'Past weekly': ["Inshiku 7", "Masiku 7"],
  'Past monthly': ["Inshiku 30", "Masiku 30"],
  'Search receipt number or cashier…': ["Fwayeni namba ya risiti nangu umushitishi…", "Sakani nambala ya risiti kapena wogulitsa…"],
  'Previous': ["Ku numa", "Kumbuyo"],
  'Next': ["Ku ntanshi", "Kutsogolo"],
  '{from}–{to} of {count} transactions': ["{from}–{to} pali {count}", "{from}–{to} mwa {count}"],
  '0 transactions': ["Tapali", "Palibe"],
  'Loading archived sales…': ["Ifyo mwashitishe filefika…", "Malonda akubwera…"],
  'Receipt number': ["Namba ya risiti", "Nambala ya risiti"],
  'Date & time': ["Ubushiku ne nshita", "Tsiku ndi nthawi"],
  'Cashier': ["Umushitishi", "Wogulitsa"],
  'Payment': ["Ukulipila", "Malipiro"],
  'Status': ["Fyaba shani", "Momwe zilili"],
  'View': ["Moneni", "Onani"],
  'View receipt': ["Moneni risiti", "Onani risiti"],
  'No transactions yet': ["Tapalaba ukushitisha", "Palibe malonda panobe"],
  'Completed sales and receipts will appear here.': ["Ifyo mwashitisha na marisiti fikamoneka pano.", "Malonda ndi malisiti adzaonekera pano."],
  'Receipt Number / ZRA Ref': ["Namba ya risiti / ZRA", "Nambala ya risiti / ZRA"],
  'Date & Stamp': ["Ubushiku", "Tsiku"],
  'Cashier Session': ["Umushitishi", "Wogulitsa"],
  'Summary Details': ["Ifyashitishiwe", "Zogulitsidwa"],
  'Tax Code (VAT)': ["Umusonko (VAT)", "Msonkho (VAT)"],
  'Net Total': ["Pamo (ukwabula VAT)", "Zonse (popanda VAT)"],
  'Invoicing Actions': ["Ifya kucita", "Zochita"],

  // ---- shifts
  'Cashier shifts': ["Ama-shift", "Ma-shift"],
  'Opening float, drawer movements, closing cash and differences.': ["Indalama sha kutendekelako, ishifuma ne shingila mu dilowa, no kupenda ilyo mulesala.", "Ndalama zoyambira, zotuluka ndi zolowa mu dilowa, ndi kuwerenga potseka."],
  'Loading shifts…': ["Ama-shift yalefika…", "Ma-shift akubwera…"],
  'Open your shift': ["Isuleni shift yenu", "Tsegulani shift yanu"],
  'Opening cash ({currency})': ["Indalama sha kutendekelako ({currency})", "Ndalama zoyambira ({currency})"],
  'Current drawer': ["Dilowa ya nomba", "Dilowa yapano"],
  'Select shift…': ["Saleni shift…", "Sankhani shift…"],
  'Expected cash': ["Indalama shifwile ukubamo", "Ndalama zoyenera kukhalamo"],
  'Action': ["Ifyo mulefwaya ukucita", "Zochita"],
  'Cash withdrawal / transfer out': ["Ukufumya indalama", "Kutulutsa ndalama"],
  'Cash added / transfer in': ["Ukuleta indalama", "Kuyika ndalama"],
  'Close shift & count cash': ["Isaleni shift no kupenda indalama", "Tsekani shift ndi kuwerenga ndalama"],
  'Counted cash': ["Indalama mwapenda", "Ndalama zowerengedwa"],
  'Reason / closing notes': ["Umulandu / ifyalembwa", "Chifukwa / zolemba"],
  'Record shift close': ["Isaleni shift", "Tsekani shift"],
  'Record drawer movement': ["Lembeni", "Lembani"],
  'Drawer transfers do not count as business income or expenses. Record genuine expenses in Cashbook. Refunds affect the approver’s open drawer.': ["Indalama ishifuma nangu ukwingila mu dilowa tashipendwa nge nonko nangu ifyo mwaonaula. Ifyo mwaonaula lembeni mu Cashbook. Ukubwesesha kasita indalama kufuma mu dilowa ya uwasuminisha.", "Ndalama zotuluka kapena zolowa mu dilowa siziwerengedwa ngati phindu kapena zogwiritsidwa ntchito. Lembani zogwiritsa ntchito zenizeni mu Cashbook. Ndalama zobwezedwa kwa kasitomala zimachoka mu dilowa ya amene wavomereza."],
  'No open shifts.': ["Tapali shift iyaisuka.", "Palibe shift yotsegula."],
  'Shift history': ["Ama-shift ya kale", "Ma-shift akale"],
  'Drawer movement log': ["Indalama ishafuma ne shingila", "Ndalama zotuluka ndi zolowa"],
  'Opened': ["Yaisukile", "Inatsegulidwa"],
  'Closed': ["Yaisalwa", "Inatsekedwa"],
  'Opening': ["Ukutendeka", "Zoyambira"],
  'Expected': ["Ishifwile", "Zoyenera"],
  'Counted': ["Ishapendwa", "Zowerengedwa"],
  'Difference': ["Ubupusano", "Kusiyana"],
  'Date': ["Ubushiku", "Tsiku"],
  'Direction': ["Ukufuma / ukwingila", "Kutuluka / kulowa"],
  'Reason': ["Umulandu", "Chifukwa"],
  'Shift opened. You can start selling.': ["Shift yaisuka. Kuti mwatendeka ukushitisha.", "Shift yatsegulidwa. Mungayambe kugulitsa."],
  'Shift closed. Cash matches.': ["Shift yaisalwa. Indalama shalingana.", "Shift yatsekedwa. Ndalama zikugwirizana."],
  'Shift closed. Cash is over by {amount}.': ["Shift yaisalwa. Indalama shacilamo ne {amount}.", "Shift yatsekedwa. Ndalama zachuluka ndi {amount}."],
  'Shift closed. Cash is short by {amount}.': ["Shift yaisalwa. Indalama shacepako ne {amount}.", "Shift yatsekedwa. Ndalama zachepa ndi {amount}."],
  'Cash added to the drawer.': ["Indalama shabikwa mu dilowa.", "Ndalama zaikidwa mu dilowa."],
  'Cash withdrawal recorded.': ["Indalama ishafumishiwe nashilembwa.", "Ndalama zotulutsidwa zalembedwa."],
  'Choose the branch you are working at (top of the screen) before opening your shift.': ["Saleni branchi mulebombelapo (pa muulu wa screen) ilyo tamulaisula shift.", "Sankhani nthambi imene mukugwirira ntchito (pamwamba pa sikirini) musanatsegule shift."],

  // ---- my profile
  'Store': ["Shopu", "Sitolo"],
  'Role': ["Incito", "Udindo"],
  'Account access': ["Ukwingila mu akaunti", "Kulowa mu akaunti"],
  'Managed by your director': ["Kulungatika na director wenu", "Zimayendetsedwa ndi director wanu"],
  'Switch store': ["Pilibukeni ku shopu imbi", "Sinthani sitolo"],

  // ---- offline
  'Offline': ["Tapali intaneti", "Palibe intaneti"],
  'Online': ["Intaneti ilipo", "Intaneti ilipo"],
  'Syncing…': ["Filetumwa…", "Zikutumizidwa…"],
  'Needs attention': ["Fyalekabila ukumona", "Zikufunika kuonedwa"],
  'Waiting to sync': ["Filelolela ukutumwa", "Zikudikira kutumizidwa"],
  'Connection and offline sales': ["Intaneti no kushitisha kwabula intaneti", "Intaneti ndi malonda opanda intaneti"],
  'You are offline': ["Tapali intaneti", "Palibe intaneti"],
  'Connected': ["Intaneti ilipo", "Intaneti ilipo"],
  'Keep selling. Sales are saved on this device and sent automatically when the internet is back.': ["Konkanyeni ukushitisha. Ifyo mushitisha filesungwa pali ici cipe kabili fikatumwa fyeka nga intaneti yabwela.", "Pitirizani kugulitsa. Malonda akusungidwa pa chipangizo ichi ndipo adzatumizidwa okha intaneti ikabwera."],
  'Sales saved on this device are sent automatically.': ["Ifyo mwashitisha ifyasungwa pali ici cipe filatumwa fyeka.", "Malonda osungidwa pa chipangizo ichi amatumizidwa okha."],
  'All sales are saved to your store. Nothing is waiting on this device.': ["Fyonse mwashitisha fyasungwa mu shopu yenu. Tapali icilelolela pali ici cipe.", "Malonda onse asungidwa ku sitolo yanu. Palibe chomwe chikudikira pa chipangizo ichi."],
  'Nothing waiting to sync.': ["Tapali icilelolela ukutumwa.", "Palibe chomwe chikudikira kutumizidwa."],
  '1 offline sale synced.': ["Ukushitisha kumo nakutumwa.", "Malonda amodzi atumizidwa."],
  '{n} offline sales synced.': ["Ukushitisha {n} nakutumwa.", "Malonda {n} atumizidwa."],
  '1 offline sale needs attention.': ["Ukushitisha kumo kwalekabila ukumona.", "Malonda amodzi akufunika kuonedwa."],
  '{n} offline sales need attention.': ["Ukushitisha {n} kwalekabila ukumona.", "Malonda {n} akufunika kuonedwa."],
  'Still offline. Sales will sync when the connection returns.': ["Tapali intaneti nomba. Ifyo mwashitisha fikatumwa nga intaneti yabwela.", "Palibe intaneti panobe. Malonda adzatumizidwa intaneti ikabwera."],
  'A sale is rejected when stock ran out or your shift was closed before it synced. Open your shift or adjust stock, then retry.': ["Ukushitisha kulakanwa nga ifintu fyapwile nangu shift yaisalwa ilyo tafilatumwa. Isuleni shift nangu lungikeni ifintu, lyena eseshenipo nakabili.", "Malonda amakanidwa ngati katundu anatha kapena shift inatsekedwa asanatumizidwe. Tsegulani shift kapena konzani katundu, kenako yesaninso."],
  'Sync now': ["Tumeni nomba", "Tumizani tsopano"],
};

const INDEX = { bem: 0, nya: 1 };
let current = 'en';
const listeners = new Set();
const known = code => LANGUAGES.some(l => l.code === code);
const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } };

/** Translate English text into the current language; {name} placeholders are filled from vars. */
export function t(text, vars) {
  let out = current !== 'en' && PHRASES[text]?.[INDEX[current]] || text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}

export const getLanguage = () => current;

export function setLanguage(code) {
  const next = known(code) ? code : 'en';
  if (next === current) return;
  current = next;
  if (typeof document !== 'undefined') document.documentElement.lang = LANGUAGES.find(l => l.code === next).html;
  listeners.forEach(fn => fn(next));
}

export function subscribeLanguage(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Remembered per person on this device (works offline); also saved to their account so it follows them.
export const storedLanguage = uid => read('ipos.lang.' + (uid || 'device')) || read('ipos.lang.device') || 'en';
export function rememberLanguage(uid, code) { write('ipos.lang.' + (uid || 'device'), code); write('ipos.lang.device', code); }
