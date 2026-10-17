// Original summaries of standard dish styles and named products, researched 2026-10-17.
// These are not verified Café Ambiente recipes. House-only names stay explicitly unconfirmed.
const sources = {
  puttanesca: ['Good Food: puttanesca', 'https://www.bbcgoodfood.com/recipes/spaghetti-puttanesca'],
  kare: ['Panlasang Pinoy: kare-kare', 'https://panlasangpinoy.com/kare-kare-recipe/'],
  inasal: ['Panlasang Pinoy: chicken inasal', 'https://panlasangpinoy.com/grilled-chicken-inasal-recipe/'],
  camaron: ['Panlasang Pinoy: camaron rebosado', 'https://panlasangpinoy.com/seafood-fried-shrimp-camaron-rebosado-recipe/'],
  espresso: ['IBA: Espresso Martini', 'https://iba-world.com/iba-cocktail/espresso-martini/'],
  cosmo: ['IBA: Cosmopolitan', 'https://iba-world.com/iba-cocktail/cosmopolitan/'],
  sour: ['IBA: Whiskey Sour', 'https://iba-world.com/iba-cocktail/whiskey-sour/'],
  margarita: ['IBA: Margarita', 'https://iba-world.com/iba-cocktail/margarita/'],
  moet: ['Moët & Chandon: Impérial', 'https://www.moet.com/en-gb/foodpairing/moet-imperial'],
  moscato: ['Yellow Tail: Moscato', 'https://www.yellowtailwine.com/en-au/product/moscato/'],
  black: ['Johnnie Walker: Black Label', 'https://www.johnniewalker.com/en-hk/our-whisky/core-range/johnnie-walker-black-label'],
  grant: ['The Glen Grant: collection', 'https://www.theglengrant.com/products/'],
  java: ['Nestlé Professional: Java Chip Mocha Frappe', 'https://www.nestleprofessional.ph/recipe/java-chip-mocha-frappe'],
  salted: ['NESCAFÉ: Salted Caramel Frappe', 'https://www.nescafe.com/ph/recipes/salted-caramel-frappe'],
  americano: ['Starbucks at Home: Caffè Americano', 'https://athome.starbucks.com/recipe/caffe-americano'],
  mocha: ['Starbucks at Home: Caffè Mocha', 'https://www.starbucksathome.com/gb/recipes/caffe-mocha'],
  pain: ['King Arthur Baking: Pain au Chocolat', 'https://www.kingarthurbaking.com/recipes/pain-au-chocolat-recipe'],
  forest: ['King Arthur Baking: Black Forest Cake', 'https://www.kingarthurbaking.com/recipes/black-forest-cake-recipe'],
  cake: ['King Arthur Baking: Chocolate Cake', 'https://www.kingarthurbaking.com/recipes/chocolate-cake-recipe'],
  hotchocolate: ['King Arthur Baking: Hot Chocolate', 'https://www.kingarthurbaking.com/recipes/homemade-hot-chocolate-recipe'],
  eaglehawk: ['Wolf Blass: Eaglehawk Cabernet Sauvignon 2022', 'https://www.wolfblass.com/en-nz/wolf-blass-eaglehawk-cabernet-sauvignon-2022-8098750.html'],
  sexton: ['The Sexton: Irish single malt', 'https://thesextonwhiskey.com/'],
  tenjaku: ['Tenjaku: production and blending', 'https://tenjakuwhiskyusa.com/whisky/'],
  gold: ['Sapporo: Yellow Tail Gold Moscato', 'https://www.sapporobeer.jp/product/wine/3Q71/'],
};

// category | name | description | optional confirmation note | optional source key
const rows = [
  ['Frappe', `
Cappuccino Frappe|An iced, blended drink inspired by cappuccino, combining coffee flavor with a creamy base and crushed ice. Expect a thick, frosty texture rather than the light foam of a hot cappuccino.
Java Chip Frappe|A blended coffee-style drink with chocolate chips or chocolate pieces. Its appeal is the contrast between a creamy, icy base and little chocolate bites; the café should confirm the coffee base and toppings.
Toasted Java Frappe|A coffee-style frappe with a toasted flavor theme and a thick, blended-ice texture. The name does not specify whether the toasted component is a syrup, cookie or other ingredient.|Confirm the toasted flavor and whether it contains nuts with the barista.
Oreo Frappe|A cookies-and-cream style blended drink named for Oreo chocolate sandwich cookies. Expect sweet cocoa-cookie flavor and a creamy, icy texture; coffee content and toppings depend on the house recipe.
Caramel Frappe|A sweet, creamy blended-ice drink with caramel's cooked-sugar flavor. The menu does not specify whether the base includes coffee or whether caramel is blended in, drizzled on top, or both.
Mocha Cookie Crumble Frappe|A mocha-inspired frappe combining chocolate, coffee-style flavor and cookie crumbs. It is a dessert-style drink with a thick frozen texture; confirm the coffee base and cookie topping with the barista.
Triple Chocolate Frappe|A thick, chocolate-focused blended drink whose name indicates several chocolate components. The menu does not identify the chocolate types, toppings or whether coffee is included.
Black Forest Frappe|A blended drink inspired by Black Forest cake, traditionally associated with chocolate, cherries and cream. The café's fruit component, coffee base and garnish are not specified.|Confirm whether the house version includes cherry, alcohol or coffee before describing those as ingredients.
White Choco Frappe|A sweet blended-ice drink built around white-chocolate flavor, which is typically milky and vanilla-like rather than cocoa-forward. Coffee content and toppings are not specified on the menu.
Rocky Road Frappe|A frozen dessert-style drink inspired by rocky road, a chocolate confection commonly paired with marshmallows and nuts. The house recipe and toppings are not listed.|Ask the barista to confirm the nuts, marshmallows and coffee base.
Salted Caramel Frappe|A creamy, frozen caramel drink with a salty accent intended to balance its sweetness. The exact salt level, toppings and presence of coffee depend on the café's recipe.
Autumn Pumpkin Spice Kiss|A seasonal frappe with a pumpkin-spice theme. Pumpkin spice usually refers to warm baking spices such as cinnamon, ginger and nutmeg; it does not establish that pumpkin purée is included.|Confirm the actual spices, pumpkin ingredient and coffee base.
Ambiente Merry Christmas Frappe|Café Ambiente's named Christmas frappe, listed as a blended drink. The menu provides no flavor, base or topping details, so a specific recipe cannot be established from its name.|Ask the barista for the current seasonal recipe before recommending a flavor.
Blueberry Cheesecake Frappe|A blended dessert drink inspired by blueberry cheesecake: sweet berry flavor with a creamy, tangy cheesecake-style character. The menu does not establish whether it includes cream cheese, real berries or a biscuit topping.
Banana Coffee Pudding Frappe|A banana-and-coffee frappe with a pudding-inspired dessert theme. Expect the named banana and coffee flavor combination; the menu does not specify the pudding component or texture additions.
Biscoff Frappe|A blended drink named for Biscoff caramelized biscuits or their spread. The flavor theme is caramelized sugar and warm spice with a creamy, icy base; confirm the biscuit or spread used and whether coffee is included.
Velvet Dreams|A house-named frappe listed without a flavor or ingredient description. Its category identifies a blended drink, but the name alone cannot establish red velvet, chocolate, fruit or a coffee base.|Ask the barista for the flavor, ingredients and toppings; do not assume this is red velvet.
`],
  ['Hot Coffee', `
Espresso (1 shot)|One concentrated shot of coffee brewed by forcing hot water through finely ground coffee. It has an intense aroma, a small serving volume and usually a thin crema on top; the menu specifies one shot.
Doppio (2 shots)|A double espresso: two shots of concentrated coffee served together. It offers more coffee than the single espresso, without implying added milk, water or syrup.
Cafe Americano|Espresso diluted with hot water to make a longer black coffee. It retains espresso's roasted character with a lighter concentration; milk and sweetener are not inherent to the standard drink.
Cappuccino|An espresso-based drink with steamed milk and a prominent layer of milk foam. Its texture is airy and its coffee character usually more pronounced than a latte with a similar espresso dose.
Cafe Latte|Espresso combined with steamed milk and a relatively thin layer of fine foam. The milk softens the coffee's bitterness and gives the drink a smooth, creamy body.
Cafe Mocha|A hot coffee drink that typically combines espresso, chocolate and steamed milk. It balances roasted coffee with cocoa sweetness; whipped cream and chocolate garnish depend on the café's preparation.
White Mocha|A mocha-style coffee using white-chocolate flavor with espresso and milk. It is usually sweeter and milkier in character than a cocoa-based mocha; the house sauce and topping are not specified.
Cafe Macchiato|Macchiato means coffee marked with milk; a traditional espresso macchiato uses espresso with a little milk or foam. This menu's larger size options may indicate a different house style.|Confirm whether this is an espresso macchiato, a milk-forward version or a flavored house recipe.
Flavoured Cappuccino|A cappuccino-style espresso drink with steamed milk, foam and an added flavor. The menu does not list the syrup choices, so confirm the available flavor before placing the order.
Flavoured Latte|A milk-forward espresso latte with an added flavor, typically supplied by a syrup or sauce. The current flavor options and sweetness depend on the café and are not named on the menu.
Spiced Ambiente Christmas|A seasonal hot coffee special with a spiced Christmas theme. Its listing identifies the drink category and available sizes, but not the spices, milk, syrups or espresso recipe.|Ask the barista for the current ingredients and flavor profile.
`],
  ['Iced Coffee', `
Iced Latte|Espresso and cold milk served over ice. It has a smooth, milky coffee character; added syrup or sweetener depends on the house recipe.
Iced Cafe Mocha|A chilled mocha-style drink combining coffee, chocolate and milk over ice. Expect cocoa sweetness alongside roasted coffee; the chocolate sauce and topping are house-specific.
Iced Coffee Vanilla|An iced coffee drink flavored with vanilla. Vanilla adds a sweet, aromatic character, while the menu does not specify the brewing method, amount of milk or syrup used.
Triple Chocolate Iced Coffee|An iced coffee special with a triple-chocolate theme. Coffee and chocolate are named, but the menu does not identify the three chocolate components, milk base or topping.
Iced Macchiato|An iced macchiato-style coffee, commonly prepared with milk and espresso over ice. Because iced macchiato recipes vary, the name does not confirm caramel, vanilla or a particular layered preparation.|Confirm the house syrup and milk recipe with the barista.
Iced Americano|Espresso diluted with water and served cold over ice. It is a black coffee style with a clean, roasted flavor and no milk as part of the standard preparation.
Mistletoe Christmas Special|A seasonal special listed under iced coffee. The menu does not disclose its flavoring, milk, garnish or coffee preparation, so these cannot be inferred from the Christmas-themed name.|Ask the barista for the current recipe and ingredients.
`],
  ['Tea Drinks', `
Hot Matcha Green Tea|A hot drink made with matcha, finely powdered green tea that is whisked into liquid rather than steeped and removed. Matcha has a grassy, earthy flavor; this listing does not specify whether the café uses water or milk.
Iced Matcha Green Tea|A chilled drink featuring powdered matcha green tea, with an earthy, grassy character. The menu does not establish whether this is a water-based tea or a milk-based matcha latte, or how it is sweetened.
Hot Tea Regular|A hot tea selection listed without a tea variety. The two menu options have different prices but no stated size or blend distinction.|Ask which tea and serving correspond to Option 1 or Option 2; do not assume black, green or herbal tea.
Iced Tea|Tea served chilled, usually over ice. The menu does not specify the tea variety, lemon flavoring, brewing method or whether it is sweetened.
Hot Kalamansi|A warm calamansi citrus drink. Calamansi has a sharp, fragrant sourness often balanced with sweetener; the menu does not specify added honey, sugar or tea.
Iced Kalamansi|A cold calamansi citrus drink with a bright, tart flavor. Sweetener level and whether it contains tea are not specified by the name.
`],
  ['Smoothies', `
Mango Banana|A smoothie combining mango's tropical sweetness with banana's mellow flavor and thick texture. The liquid base, fruit form and added sweetener are not specified.
Strawberry Banana|A blended fruit drink pairing strawberry's sweet-tart flavor with banana's creamy texture. The menu does not identify the milk, yogurt or other blending liquid used.
Sweet Mango|A mango-focused smoothie with a sweet tropical fruit profile and a thick, cold texture. The menu does not specify whether it uses fresh fruit, purée or syrup, or whether dairy is included.
Watermelon|A cold blended drink with watermelon's light, juicy flavor. Its liquid base, added sweetener and use of fresh fruit or flavoring are not stated.
Strawberry|A strawberry-flavored smoothie with a sweet-tart berry character. The house liquid base, fruit preparation and toppings are not listed.
Mango Float Supreme|A smoothie inspired by Filipino mango float, a layered mango dessert traditionally made with cream and graham crackers. The name suggests that dessert theme, but the exact smoothie ingredients and toppings are unconfirmed.
Mango Banana Supreme|A premium house variation of the mango-and-banana smoothie. Mango and banana are named, but the menu does not explain what the Supreme version adds.|Ask the barista which toppings or ingredients distinguish it from Mango Banana.
Creamy Avocado|An avocado smoothie with a creamy texture and a mild, rich fruit flavor. The menu does not identify the milk, sweetener or other ingredients used to blend it.
Strawberry Delight|A house strawberry smoothie variation. Strawberry is the named flavor, but the menu does not specify how Delight differs from the regular strawberry smoothie.|Confirm the base, toppings and additions with the barista.
Lychee Amore|A lychee-themed smoothie with the fruit's fragrant, floral sweetness. The name does not establish the other fruit, liquid base, toppings or use of whole lychee.
`],
  ['Chocolate', `
Hot Chocolate|A warm chocolate drink, typically prepared by mixing cocoa or chocolate into milk or another liquid. Expect a cocoa-forward, sweet profile; the exact chocolate and dairy base are not specified.
Cold Chocolate|A chilled chocolate beverage with a sweet cocoa flavor. The menu does not state whether it is served over ice or blended, or which milk or chocolate is used.
Indulgent Cupid|A house special in the chocolate-drink category. Its name does not identify the chocolate type, temperature, fruit, garnish or other ingredients.|Ask the barista for the current preparation; do not infer strawberry or alcohol from the name.
`],
  ['Beef / Chicken', `
Spicy Chicken Kebab|A spicy chicken dish in the kebab style, commonly made with seasoned chicken cooked on skewers. Expect savory seasoning and heat; the marinade, cut, accompaniments and exact cooking method need house confirmation.
Chicken Adobo-sal (Adobo - Inasal)|A house chicken dish named as a combination of adobo and inasal. Adobo traditionally brings vinegar-and-garlic savory flavors, while inasal is associated with marinated grilled chicken.|Confirm how the café combines the two preparations and which sides are included.|inasal
Cheesy Crispy Fried Chicken|Fried chicken with a crisp exterior and a cheese component. The name establishes the crunchy chicken and cheese theme, but not the cut, cheese sauce, portion or accompanying sides.
Spicy Chicken Wings|Chicken wings prepared with spicy seasoning or sauce. Expect savory chicken with a hot flavor profile; the sauce style, heat level, piece count and cooking method are not specified.
Grilled BBQ Chicken|Chicken cooked on a grill with a barbecue flavor profile. It commonly has smoky, savory and sweet notes, but the café's glaze, chicken cut and included sides are not listed.
Ambiente Style Fried Chicken|Café Ambiente's house fried chicken. The menu identifies the fried preparation but does not disclose its seasoning, coating, sauce, cuts or portion size.|Ask the kitchen what distinguishes the Ambiente style and which sides are included.
Spicy Grilled Chicken|Grilled chicken with a spicy seasoning or marinade, combining a charred surface with a hot, savory flavor. The chicken cut, heat level and side dishes are not specified.
Beef Puttanesca|A beef dish with a puttanesca theme. Traditional puttanesca is a bold tomato sauce flavored with olives, capers, garlic and often anchovies; this listing does not state whether pasta is included.|Confirm the house sauce ingredients and whether the dish comes with pasta, rice or another side.|puttanesca
Spicy Fried Chicken Kare-Kare Pancit|A house fusion dish combining spicy fried chicken, pancit noodles and a kare-kare theme. Traditional kare-kare uses a thick peanut sauce, but the café's noodle, vegetable and sauce recipe is not published.|Confirm the peanut sauce and any shrimp-paste accompaniment with the kitchen.|kare
Beef and Mushroom|A savory dish pairing beef with mushrooms. Mushrooms add an earthy character, but the menu does not identify the beef cut, sauce, cooking method or accompanying rice or vegetables.
Kobe A5 Wagyu Egg Fried Rice|An egg-fried-rice dish listed with Kobe A5 Wagyu beef. Egg and beef add richness to the savory rice; the menu does not specify the beef quantity, vegetables or seasonings.|The beef designation is reproduced from the menu; provenance and certification require supplier confirmation.
Beef Belly Steak|A steak-style preparation using beef belly, a rich, fatty cut. Cooking, tenderness, sauce, portion weight and side dishes depend on the house preparation and are not stated.
Truffle Chicken Popcorn|Bite-sized chicken pieces with a truffle flavor theme, typically in a crisp popcorn-chicken style. The menu does not establish whether the truffle component is oil, seasoning, sauce or fresh truffle.
Char Grilled Japanese Wagyu Skewers|Skewered Japanese Wagyu beef cooked over a char grill. The named beef style suggests a rich, marbled character, while skewer count, cut, grade, glaze and side dishes are not specified.
USDA Prime Striploin|A striploin steak listed as USDA Prime, a beef quality grade associated with abundant marbling. Striploin is a loin cut with a firm steak texture and a fatty edge; portion weight, doneness and sides need confirmation.
Japanese Kobe A5 Wagyu Steak (per gram)|A steak listed as Japanese Kobe A5 Wagyu, sold by weight. The menu's price is per gram, so the total depends on the selected steak's weight; the named style is associated with extensive marbling.|Confirm the steak weight, cooking preference and supplier certification before quoting a full serving price.
`],
  ['Burgers / Sandwiches', `
Clubhouse Classic / Pesto|A clubhouse sandwich offered with a Classic or Pesto choice. A club is usually a layered sandwich, while pesto commonly adds a basil-herb flavor; the menu does not list the fillings or identify the pesto recipe.|Confirm the chosen variant, meat, egg, cheese and any nuts in the pesto.
Classic American Angus Cheese Burger|An American-style cheeseburger with an Angus beef patty and cheese in a bun. The exact patty weight, cheese, vegetables, condiments and side dish are not specified.
Truffle Cheese Burger|A cheeseburger with a truffle flavor component, bringing an earthy aroma alongside the patty, cheese and bun. The menu does not identify the meat, truffle sauce, patty weight or included sides.
Croissant Caprese Sandwich|A Caprese-inspired sandwich in a flaky croissant. The traditional Caprese combination is tomato, mozzarella and basil; the café's dressing and extra fillings are not specified.
Spicy Fried Chicken Burger|A burger-style sandwich with spicy fried chicken in a bun. It combines crisp chicken with heat; sauce, vegetables, chicken cut and sides vary with the house recipe.
Double Cheese Burger|A double cheeseburger listed without a patty or cheese specification. Double commonly indicates two patties, extra cheese or both, so confirm the café's actual configuration before quoting the portion.
`],
  ['Desserts / Cakes / Pastries', `
Salted Caramel Coffee Mousse|A mousse dessert combining coffee and salted caramel flavors. Mousse is typically light and aerated, contrasting roasted coffee with caramel sweetness and a salty accent; the base and garnishes are not listed.
Pistachio Cake|A cake featuring pistachio flavor, known for its mild, nutty character. The menu does not identify the sponge, cream, filling, decoration or serving size.
Blueberry Cheesecake|A cheesecake paired with blueberry, combining a rich, tangy cheese-based dessert with a sweet-tart berry element. The menu does not specify whether it is baked, chilled or topped with a blueberry compote.
Chocolate Cake|A chocolate-flavored cake with a cocoa-forward profile. The sponge, filling, frosting, richness and serving size depend on the café's version and are not identified on the menu.
Ambiente Supreme Cake|Café Ambiente's house-named Supreme cake. The menu does not identify its flavor, layers, filling or frosting, so those details cannot be inferred from the name.|Ask staff for the cake's current flavor and ingredients.
Pain Au Chocolat|A French laminated pastry with chocolate inside folded layers of dough. Baking gives it a flaky exterior and a soft, layered center around the chocolate.
Roasted Cinnamon Croissant Roll|A cinnamon-flavored croissant roll combining laminated pastry layers with a warm spice profile. The exact filling, glaze, roasting method and size are not given.
Ensaymada Danish|A pastry named as a combination of Filipino ensaymada and a Danish. Ensaymada is traditionally sweet, buttery bread often finished with sugar and cheese, while Danish pastry uses layered dough.|Confirm the house filling and topping rather than assuming all traditional ensaymada ingredients are included.
Mango Creme Cake|A mango-and-cream themed cake with a tropical fruit and creamy flavor profile. Its sponge, filling, frosting and use of fresh mango or flavoring are not specified.
Triple Truffle Cake|A cake with a triple-truffle theme, commonly associated with rich chocolate confectionery rather than culinary truffle mushrooms. The menu does not identify the three components or the cake's layers.|Confirm the chocolate types and filling with staff.
Black Forest Cake|A cake style traditionally combining chocolate sponge, cherries and whipped cream. Some versions contain cherry spirit, but the menu does not confirm the café's fruit, cream or alcohol recipe.
Croissant|A crescent-style French pastry made from dough laminated with layers of fat, traditionally butter. Its baked layers give it a crisp, flaky outside and a soft, airy interior; fillings are not named for this item.
`],
  ['Seafood / Vegetables', `
Char Grilled Sweet Corn|Sweet corn cooked over a char grill, giving the kernels smoky, roasted notes alongside their natural sweetness. Butter, seasoning, sauce and portion size are not listed.
Seafood Sotanghon|A seafood dish with sotanghon, thin translucent glass noodles commonly made from starch such as mung bean. The menu does not specify the seafood mix or whether the noodles are stir-fried, saucy or served in broth.
Ambiente Salad|Café Ambiente's house salad. Its vegetables, protein, dressing and toppings are not identified by the menu, so a specific ingredient list cannot be inferred.|Ask staff for the current greens, dressing and additions.
Smoked Caesar Salad|A Caesar-style salad with a smoked theme. Traditional Caesar salad uses crisp greens, a savory dressing, croutons and hard cheese; this name does not establish which ingredient is smoked.|Confirm the smoked component and whether the dressing includes anchovy or egg.
Fried Calamari|Fried squid, commonly cut into rings or bite-sized pieces and coated before frying. Expect a crisp outside and tender-chewy squid inside; the coating, dip and portion are house-specific.
Camaron Rebosado|A Filipino shrimp dish traditionally made by coating shrimp in batter and deep-frying them. The batter forms a crisp shell around the shrimp; the dip and serving size depend on the house preparation.||camaron
Kinilaw Waray|A Waray-style kinilaw, a dish traditionally featuring raw seafood dressed with vinegar or another souring liquid and aromatics. The seafood species, souring liquid and regional additions are not specified.|Confirm the fish or seafood used and the house preparation with the kitchen.
Whole Roasted Garlic Butter Shrimps|Whole shrimp roasted with garlic and butter, pairing sweet seafood with a rich, aromatic coating. The menu does not state the shrimp count, size or accompanying sides.
Grilled Tuna Belly|Tuna belly cooked on a grill. The belly is a fatty, rich part of the fish, while grilling adds a charred exterior; marinade, doneness and side dishes are not specified.
Char Grilled Squid|Squid cooked over a char grill for a smoky surface and tender-chewy texture. The listing does not identify a stuffing, marinade, glaze or portion size.
Crispy Skin Salmon|Salmon prepared to give the skin a crisp texture while retaining a moist interior. The precise cooking method, sauce, portion and side dishes are not provided.
Steamed Salmon|Salmon gently cooked with steam, a method that typically produces a moist, delicate texture. The menu does not specify seasonings, sauce, vegetables or serving weight.
`],
  ['Pasta', `
Spicy Spaghetti Marinara|Spaghetti with a spicy marinara-style sauce, traditionally based on tomato, garlic and herbs. Marinara by itself does not establish seafood; ask staff about any added protein and the heat level.
Slow Cooked Spaghetti Bolognese|Spaghetti with a slow-cooked Bolognese-style meat sauce. The style is rich and savory, usually combining meat, aromatics and tomato; the café's meat blend and use of milk or wine are unconfirmed.
Fettuccine Alfredo Chicken|Flat fettuccine noodles paired with chicken and an Alfredo-style sauce. Expect a rich, buttery or creamy cheese character; the café's use of cream, cheese and other additions needs confirmation.
Baked Three Cheese Macaroni|Macaroni baked with a blend of three cheeses. The dish has a rich, cheesy character and may have a browned top; the specific cheeses, sauce and portion are not listed.
Spaghetti Seafood Marinara|Spaghetti combining seafood with a marinara-style tomato sauce. Tomato acidity balances the savory seafood; the actual mix of shrimp, squid, fish or shellfish must be confirmed.
Spaghetti Seafood Pasta|Spaghetti with seafood, listed separately from Seafood Marinara. The name does not identify whether the sauce uses tomato, cream or oil, or which seafood is included.|Ask the kitchen how this differs from Seafood Marinara.
Spaghetti Shrimp Pasta|Spaghetti paired with shrimp. The menu does not identify the sauce, garlic, herbs, spice level or shrimp quantity, so a creamy or tomato preparation should not be assumed.
Penne Chicken Pesto Pasta|Tube-shaped penne pasta combined with chicken and pesto. Traditional basil pesto has an aromatic herb, oil, cheese and nut profile, but the café's pesto ingredients are not listed.
Fried Shrimp Pasta|A pasta dish featuring fried shrimp, adding a crisp seafood component. The menu does not state the pasta shape, coating, sauce or shrimp quantity.
Spaghetti and Artisanal Meatballs|Spaghetti served with meatballs described on the menu as artisanal. The meat blend, sauce, seasonings, binder and number of meatballs are not specified.
`],
  ['Pica-Pica / Soups', `
Mushroom Soup|A soup centered on mushrooms and their earthy, savory flavor. The menu does not specify whether it is cream-based, blended smooth or served as a broth with mushroom pieces.
Truffle Parmesan Fries|Fried potato strips with Parmesan and a truffle flavor component. Expect salty cheese and an earthy aroma; the menu does not establish whether the truffle comes from oil, seasoning or another ingredient.
Fiesta Strips|A house snack named Fiesta Strips. The menu does not identify the main ingredient, coating, seasoning or dip, so it cannot reliably be described as chicken, fish, meat or vegetables.|Ask the kitchen what the strips are made from and how they are served.
Chicken Strips|Chicken cut into strips, commonly coated and fried as a snack or appetizer. The menu does not establish the exact cooking method, breading, dip or number of pieces.
Mozzarella Sticks|Mozzarella cheese formed into sticks, commonly breaded and fried. The usual result is a crisp coating around warm, stretchy cheese; dipping sauce and piece count are house-specific.
Fried Fish Strips|Fish cut into strips and fried, commonly with a crisp batter or breading. The fish species, coating, seasoning and accompanying dip are not listed.
1 Cup Rice|One cup of plain cooked rice, offered as an extra side. It has a mild flavor suited to pairing with sauced or grilled dishes; the rice variety is not specified.
Tomato Soup|A tomato-based soup with the fruit's naturally sweet-tart flavor. The menu does not specify whether it is smooth, chunky, cream-enriched or served with bread.
Chips and Beefy Delight|A chips-based house snack with a beef-themed component. The menu does not identify the chips, beef preparation, cheese, sauce or toppings.|Ask the kitchen what Beefy Delight contains and whether it is served as a topping or dip.
Chips and Dip|A snack pairing chips with a dipping sauce. The chip type and dip flavor are not named, so tortilla chips, potato chips, salsa or cheese dip should not be assumed.
French Fries|Potato strips fried until golden, typically with a crisp outside and soft center. The menu does not specify the cut, seasoning, dip or portion weight.
1 Cup Garlic Rice|One cup of garlic-flavored rice, commonly prepared by stir-frying cooked rice with garlic. It is a savory side with a toasted-garlic aroma; the exact oil and seasonings are house-specific.
Extra Toast / Nachos / Dip / Egg|A separately priced extra with a choice of toast, nachos, dip or egg. The slash-separated listing is not evidence that all four are included together.|Confirm the chosen extra, quantity, dip flavor and egg preparation before adding it to an order.
`],
  ['Sparkling Wine', `
Moet & Chandon Champagne Brut|A brut Champagne from Moët & Chandon: an alcoholic sparkling wine from France's Champagne region. Brut indicates a dry style; the menu does not specify the cuvée, so bottle-specific tasting notes require checking the label.|Confirm the cuvée and bottle size; Impérial is a producer reference, not a confirmed identification of this listing.|moet
Juvé & Camps Cava 2018 Gran Reserva|A 2018 Gran Reserva Cava from Juvé & Camps. Cava is Spanish sparkling wine made with a second fermentation in the bottle; Gran Reserva indicates extended aging, often contributing a more developed, toasty character.|Confirm the exact cuvée, sweetness designation and bottle size from the label.
Cinzano Prosecco|An Italian Prosecco from Cinzano. Prosecco is generally a fresh, fruit-led sparkling wine, commonly associated with apple, pear and floral notes; the listed name does not identify its sweetness designation or bottle size.
Cinzano Asti|An Italian Asti sparkling wine from Cinzano. Asti is made from aromatic Moscato grapes and is typically sweet, fragrant and fruity, making it a dessert-friendly style; check the bottle for its strength and size.
`],
  ['White Wine', `
Adega de Pegões|A white-wine listing from Adega de Pegões, a Portuguese producer. The menu does not name the cuvée, vintage or grape blend, so its exact sweetness, body and tasting profile cannot be established.|Check the bottle label before describing the grapes or flavor.
Yellow Tail Gold Moscato|A lightly sparkling white Moscato with a fruity Muscat-grape character. Sapporo's official Gold Moscato listing describes it as suitable before a meal or alongside sweets; chilling emphasizes its refreshing bubbles and aromatic fruit.|Gold Moscato is a documented product, separate from the regular Moscato listing. Confirm the stocked bottle and serving size.|gold
Santa Carolina Premio 2021|A 2021 Santa Carolina Premio listed in the white-wine section. The menu does not identify its grape variety or blend, so a specific dry, sweet, citrus or oak profile needs bottle confirmation.
Mapu Sauvignon Blanc–Chardonnay 2022|A 2022 white blend named for Sauvignon Blanc and Chardonnay. These grapes commonly combine fresh citrus or herbal character with rounder fruit texture; the blend proportions, oak use and exact tasting notes are unconfirmed.
Barton & Guestier|A white-wine listing from the French wine house Barton & Guestier. The brand makes several wines, and this entry does not identify the label, region, grapes or vintage.|Confirm the exact bottle before quoting a sweetness level or tasting profile.
`],
  ['Red Wine', `
Wolf Blass Bilyara Cabernet Sauvignon 2022|A 2022 Cabernet Sauvignon from Wolf Blass's Bilyara range. Cabernet Sauvignon is generally a structured red-wine style with dark-fruit character and noticeable tannins; exact vintage notes and bottle size need label confirmation.
Wolf Blass Eaglehawk Cabernet Sauvignon 2022|An Australian Cabernet Sauvignon from the 2022 Eaglehawk vintage. Wolf Blass describes a medium-bodied red with blackcurrant and raspberry flavors, a savory oak accent and a soft tannin finish. Its fruit-led style is approachable rather than heavily tannic.|Producer notes apply to the named 2022 vintage; confirm the bottle currently being served.|eaglehawk
Tall Horse Cabernet Sauvignon 2022|A 2022 Tall Horse Cabernet Sauvignon. As a grape style, Cabernet Sauvignon commonly offers dark berries and a drying tannic finish; the exact vintage's body, oak treatment and bottle size are not specified.
Mapu Cabernet Sauvignon–Carmenère 2022|A 2022 red blend of Cabernet Sauvignon and Carmenère. The grape combination often brings dark-fruit flavors with herbal or spicy accents; the precise blend and vintage tasting profile require the bottle's details.
Santa Loma Cabernet Sauvignon 2024|A 2024 Cabernet Sauvignon listed as Santa Loma. The named grape is commonly associated with dark-fruit flavor and firm tannins; the producer, region and exact bottling need label confirmation.
Vezzani Rosso Puglia 2023|A 2023 red wine listed as Vezzani Rosso Puglia. Rosso means red and Puglia identifies the Italian region, but the menu does not establish the grape blend, sweetness or aging method.
Rocca Chianti 2023|A 2023 Chianti listed under Rocca. Chianti is an Italian red-wine style from Tuscany, typically led by Sangiovese and characterized by bright acidity and red-fruit notes; the exact bottling needs confirmation.
Le Corbinie Rosso Umbria|A red wine listed as Le Corbinie from Umbria, Italy. Rosso identifies a red wine, while the menu does not disclose its grape blend, vintage, body or sweetness.
Castillo Cielo|A red-wine listing named Castillo Cielo. The menu does not identify the producer, region, grapes or vintage, so its style cannot be described reliably beyond the red-wine category.|Check the full bottle label before describing the flavor or origin.
Barton & Guestier|A red-wine listing from Barton & Guestier. Because the producer makes several regional wines, the menu's brand name alone does not establish the grapes, vintage, region or tasting profile.|Check the exact bottle; this is separate from the white-wine entry with the same brand name.
René Barbier 2022|A 2022 wine listed under René Barbier in the red-wine section. The exact cuvée, grape blend and region are not identified, so detailed bottle-specific tasting notes need label confirmation.
`],
  ['Dessert Wine', `
Cálem Porto Fine Tawny|A tawny Port from Cálem, a fortified Portuguese wine. Tawny Port is typically sweet with a developed dried-fruit and nutty character; the exact bottle strength, size and serving measure should be checked.
Yellow Tail Moscato|A sweet, lightly fizzy Moscato from Yellow Tail. The producer describes a fragrant fruit-and-flower profile with refreshing tropical-fruit character; it is commonly served chilled.||moscato
Barefoot Moscato|A Moscato from Barefoot, an aromatic white-wine style typically enjoyed for sweet fruit and floral character. Confirm the exact bottle, sweetness and serving size rather than assuming it is a fortified dessert wine.
Hardys VR Moscato 2024|A 2024 Moscato from the Hardys VR range. Moscato is generally a sweet, aromatic style with fruit and floral notes; exact vintage strength and serving size are not given in the menu.
`],
  ['Whiskey', `
Johnnie Walker Black Label 12 Years|A 12-year blended Scotch whisky. The producer describes a layered sweet-fruit, spice and vanilla profile carried by smoke; this is an alcoholic spirit rather than a mixed drink.||black
Ole Smoky Flavoured/Blended|An Ole Smoky spirit listed without a specific flavor or expression. The brand's flavored and blended products vary widely in ingredients, sweetness and alcohol strength.|Confirm the bottle and chosen flavor before describing the taste or alcohol content.
Sexton Single Malt|An Irish single-malt whiskey made from malted barley, triple distilled and matured in Oloroso sherry casks. The producer describes dark-fruit and toasted-malt flavors with a smooth, rounded character. Sherry-cask maturation contributes richness to the spirit.|Confirm the stocked expression and serving measure with the bar.|sexton
Johnnie Walker Double Black|A blended Scotch whisky in Johnnie Walker's Double Black range. It is generally known for a pronounced smoky style; the menu does not state an age, and Black Label's 12-year age should not be applied to it.
Highland Park 10 Years|A 10-year Highland Park single-malt Scotch whisky. The listing identifies the producer and age, but the exact expression, strength and bottle-specific flavor notes should be checked with the bar.
Tenjaku Whiskey 3–6 Years|A Tenjaku whisky listing consistent with the producer's blended expression, which combines whiskies aged three, five and six years in seasoned bourbon barrels. The producer describes a mellow, balanced style with rich malt and gentler grain flavors.|Confirm the blended expression on the bottle; the range does not mean every component is six years old.|tenjaku
Glen Grant 18 Years|An 18-year single-malt Scotch whisky from The Glen Grant. The producer's collection notes describe floral character alongside caramel-like malt and dried-fruit notes.||grant
Johnnie Walker Blue Label|A premium blended Scotch whisky in Johnnie Walker's Blue Label range. The standard name carries no fixed age statement; the exact bottling, strength and serving presentation should be confirmed with the bar.
`],
  ['Beer', `
San Mig Light|A San Miguel beer sold as San Mig Light, commonly positioned as a light-bodied lager. It has a crisp beer profile; Light should not be interpreted as alcohol-free, and the bottle or can size is not listed.
San Miguel Pilsen|A San Miguel Pilsen lager beer. Pilsner-style lagers typically combine a malty grain character with hop bitterness and carbonation; confirm the exact product and bottle size with the bar.
Sapporo|A beer listed by the Sapporo brand name. The brand has several products, so the menu alone does not establish the exact variant, origin of the stocked bottle, alcohol strength or container size.
`],
  ['Cocktails', `
Espresso Martini|An alcoholic coffee cocktail traditionally shaken from vodka, coffee liqueur, espresso and sugar syrup. Shaking creates a fine foam, while espresso brings roasted bitterness against the liqueur's sweetness; it normally contains caffeine.||espresso
Cosmopolitan|An alcoholic cocktail traditionally combining citrus vodka, orange liqueur, cranberry juice and fresh lime. It has a tart citrus-and-cranberry character and is usually shaken and strained into a chilled glass.||cosmo
Whiskey Sour|An alcoholic cocktail traditionally made with whiskey, lemon juice and sugar syrup. It balances warming spirit with bright acidity and sweetness; some preparations add egg white for foam.|Confirm whether the house recipe uses egg white and which whiskey is poured.|sour
Margarita|An alcoholic tequila cocktail traditionally made with orange liqueur and lime juice. It is citrus-forward and tart; a salt rim is optional and the house presentation should be confirmed.||margarita
Frozen Mango Margarita|A frozen mango variation on the tequila-and-lime Margarita. Mango and blended ice add fruit sweetness and a slushy texture; the house recipe determines the liqueur, syrup, fruit preparation and rim.|Confirm the house mango recipe and garnish.|margarita
`],
];

const standardReferences = {
  'Frappe|Java Chip Frappe': 'java',
  'Frappe|Salted Caramel Frappe': 'salted',
  'Hot Coffee|Cafe Americano': 'americano',
  'Hot Coffee|Cafe Mocha': 'mocha',
  'Chocolate|Hot Chocolate': 'hotchocolate',
  'Desserts / Cakes / Pastries|Chocolate Cake': 'cake',
  'Desserts / Cakes / Pastries|Pain Au Chocolat': 'pain',
  'Desserts / Cakes / Pastries|Black Forest Cake': 'forest',
  'White Wine|Yellow Tail Gold Moscato': 'gold',
};

const descriptions = new Map(rows.flatMap(([category, entries]) => entries.trim().split('\n').map(row => {
  const [name, description, note, sourceKey] = row.split('|');
  const reference = sources[sourceKey || standardReferences[`${category}|${name}`]];
  return [`${category}|${name}`, {
    description,
    descriptionNote: note || 'Describes the named item or its usual style. Confirm the café’s ingredients, preparation and serving details with staff.',
    descriptionSources: reference ? [{ title: reference[0], url: reference[1] }] : [],
  }];
})));

const normalize = value => value.normalize('NFKC').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
const normalizedDescriptions = new Map([...descriptions].map(([key, value]) => [normalize(key), value]));

export function getMenuDescription(category, name) {
  const baseName = name.replace(/\s*\((?:\d+\s*oz|Option\s+\d+)\)\s*$/i, '');
  return normalizedDescriptions.get(`${normalize(category)}|${normalize(baseName)}`);
}

// Also used by the client: old API responses and offline caches may predate descriptions.
export function withMenuDescription(item, store) {
  const details = store === 'ambiente' ? getMenuDescription(item.category, item.name) : undefined;
  return {
    ...item,
    description: item.description?.trim() || details?.description || `${item.name} — ${item.category}.`,
    descriptionNote: item.description?.trim() ? item.descriptionNote : details?.descriptionNote,
    descriptionSources: item.description?.trim() ? item.descriptionSources : details?.descriptionSources,
  };
}
