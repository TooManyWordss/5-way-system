import { getMenuDescription } from './menu-descriptions.js';

// Each listed size is a separate POS item so the correct price reaches the cart and receipt.
// Where the source menu gives two Hot Tea Regular prices without sizes, keep both as price options.
const sections = [
  ['Frappe', '16oz,20oz', `
Cappuccino Frappe|209,229
Java Chip Frappe|209,229
Toasted Java Frappe|209,229
Oreo Frappe|219,239
Caramel Frappe|219,239
Mocha Cookie Crumble Frappe|219,239
Triple Chocolate Frappe|219,239
Black Forest Frappe|229,249
White Choco Frappe|229,249
Rocky Road Frappe|229,249
Salted Caramel Frappe|239,259
Autumn Pumpkin Spice Kiss|249,279
Ambiente Merry Christmas Frappe|249,279
Blueberry Cheesecake Frappe|249,279
Banana Coffee Pudding Frappe|249,279
Biscoff Frappe|249,279
Velvet Dreams|249,279`],
  ['Hot Coffee', '12oz,16oz,20oz', `
Espresso (1 shot)|129
Doppio (2 shots)|149
Cafe Americano|159,179,189
Cappuccino|169,189,199
Cafe Latte|169,189,199
Cafe Mocha|179,199,209
White Mocha|189,209,219
Cafe Macchiato|189,209,219
Flavoured Cappuccino|189,209,219
Flavoured Latte|189,209,219
Spiced Ambiente Christmas|16oz:229,20oz:249`],
  ['Iced Coffee', '16oz,20oz', `
Iced Latte|209,229
Iced Cafe Mocha|209,229
Iced Coffee Vanilla|209,229
Triple Chocolate Iced Coffee|209,229
Iced Macchiato|209,229
Iced Americano|199,209
Mistletoe Christmas Special|219,239`],
  ['Tea Drinks', '', `
Hot Matcha Green Tea|209
Iced Matcha Green Tea|209
Hot Tea Regular|Option 1:129,Option 2:149
Iced Tea|199
Hot Kalamansi|189
Iced Kalamansi|189`],
  ['Smoothies', '16oz,20oz', `
Mango Banana|209,229
Strawberry Banana|209,229
Sweet Mango|209,229
Watermelon|209,229
Strawberry|209,229
Mango Float Supreme|219,239
Mango Banana Supreme|219,239
Creamy Avocado|219,239
Strawberry Delight|219,239
Lychee Amore|239,279`],
  ['Chocolate', '16oz,20oz', `
Hot Chocolate|209,229
Cold Chocolate|209,229
Indulgent Cupid|239,279`],
  ['Beef / Chicken', '', `
Spicy Chicken Kebab|399
Chicken Adobo-sal (Adobo - Inasal)|419
Cheesy Crispy Fried Chicken|429
Spicy Chicken Wings|429
Grilled BBQ Chicken|439
Ambiente Style Fried Chicken|439
Spicy Grilled Chicken|449
Beef Puttanesca|529
Spicy Fried Chicken Kare-Kare Pancit|529
Beef and Mushroom|529
Kobe A5 Wagyu Egg Fried Rice|529
Beef Belly Steak|599
Truffle Chicken Popcorn|759
Char Grilled Japanese Wagyu Skewers|789
USDA Prime Striploin|899
Japanese Kobe A5 Wagyu Steak (per gram)|20`],
  ['Burgers / Sandwiches', '', `
Clubhouse Classic / Pesto|359
Classic American Angus Cheese Burger|459
Truffle Cheese Burger|799
Croissant Caprese Sandwich|299
Spicy Fried Chicken Burger|399
Double Cheese Burger|699`],
  ['Desserts / Cakes / Pastries', '', `
Salted Caramel Coffee Mousse|399
Pistachio Cake|299
Blueberry Cheesecake|198
Chocolate Cake|181
Ambiente Supreme Cake|173
Pain Au Chocolat|160
Roasted Cinnamon Croissant Roll|399
Ensaymada Danish|199
Mango Creme Cake|198
Triple Truffle Cake|173
Black Forest Cake|173
Croissant|130`],
  ['Seafood / Vegetables', '', `
Char Grilled Sweet Corn|299
Seafood Sotanghon|389
Ambiente Salad|399
Smoked Caesar Salad|479
Fried Calamari|459
Camaron Rebosado|459
Kinilaw Waray|459
Whole Roasted Garlic Butter Shrimps|499
Grilled Tuna Belly|549
Char Grilled Squid|549
Crispy Skin Salmon|589
Steamed Salmon|589`],
  ['Pasta', '', `
Spicy Spaghetti Marinara|379
Slow Cooked Spaghetti Bolognese|399
Fettuccine Alfredo Chicken|399
Baked Three Cheese Macaroni|399
Spaghetti Seafood Marinara|399
Spaghetti Seafood Pasta|399
Spaghetti Shrimp Pasta|399
Penne Chicken Pesto Pasta|399
Fried Shrimp Pasta|449
Spaghetti and Artisanal Meatballs|499`],
  ['Pica-Pica / Soups', '', `
Mushroom Soup|399
Truffle Parmesan Fries|499
Fiesta Strips|399
Chicken Strips|399
Mozzarella Sticks|329
Fried Fish Strips|399
1 Cup Rice|79
Tomato Soup|359
Chips and Beefy Delight|399
Chips and Dip|259
French Fries|199
1 Cup Garlic Rice|119
Extra Toast / Nachos / Dip / Egg|39`],
  ['Sparkling Wine', '', `
Moet & Chandon Champagne Brut|7499
Juvé & Camps Cava 2018 Gran Reserva|2999
Cinzano Prosecco|1999
Cinzano Asti|1499`],
  ['White Wine', '', `
Adega de Pegões|1299
Yellow Tail Gold Moscato|1199
Santa Carolina Premio 2021|1199
Mapu Sauvignon Blanc–Chardonnay 2022|1999
Barton & Guestier|999`],
  ['Red Wine', '', `
Wolf Blass Bilyara Cabernet Sauvignon 2022|1499
Wolf Blass Eaglehawk Cabernet Sauvignon 2022|1299
Tall Horse Cabernet Sauvignon 2022|1299
Mapu Cabernet Sauvignon–Carmenère 2022|1199
Santa Loma Cabernet Sauvignon 2024|1199
Vezzani Rosso Puglia 2023|1199
Rocca Chianti 2023|1199
Le Corbinie Rosso Umbria|1099
Castillo Cielo|1099
Barton & Guestier|1099
René Barbier 2022|1099`],
  ['Dessert Wine', '', `
Cálem Porto Fine Tawny|1499
Yellow Tail Moscato|1299
Barefoot Moscato|1199
Hardys VR Moscato 2024|999`],
  ['Whiskey', '', `
Johnnie Walker Black Label 12 Years|399
Ole Smoky Flavoured/Blended|459
Sexton Single Malt|499
Johnnie Walker Double Black|599
Highland Park 10 Years|599
Tenjaku Whiskey 3–6 Years|699
Glen Grant 18 Years|1199
Johnnie Walker Blue Label|1599`],
  ['Beer', '', `
San Mig Light|140
San Miguel Pilsen|140
Sapporo|250`],
  ['Cocktails', '', `
Espresso Martini|399
Cosmopolitan|459
Whiskey Sour|499
Margarita|599
Frozen Mango Margarita|599`],
];

export const menuCatalog = sections.flatMap(([category, sizeList, rows]) => {
  const sizes = sizeList ? sizeList.split(',') : [];
  return rows.trim().split('\n').flatMap((row) => {
    const [baseName, priceList] = row.split('|');
    return priceList.split(',').map((entry, index) => {
      const [size, price] = entry.includes(':') ? entry.split(':') : [sizes[index], entry];
      const name = size ? `${baseName} (${size})` : baseName;
      const sendsToKitchen = !['Sparkling Wine', 'White Wine', 'Red Wine', 'Dessert Wine', 'Whiskey', 'Beer'].includes(category);
      return { name, category, priceCents: Number(price) * 100, sendsToKitchen: Number(sendsToKitchen), ...getMenuDescription(category, baseName) };
    });
  });
});
