const j = require("./opencode-search-snapshot.json");
const f = require("./opencode-facets.json");
console.log("CLAIMED:", j.data.map((b) => b.slug + " | name=" + b.name + " | cat=" + b.category + " | city=" + b.city + " | promo=" + b.is_promoted).join("\n  "));
console.log("\nCATEGORIES:", f.categories.join(" / "));
console.log("\nCITIES:", f.cities.join(" / "));
console.log("\nNEIGHBORHOODS:", f.neighborhoods.slice(0, 10).join(" / "));
console.log("\nUNCLAIMED sample:", j.unclaimed.slice(0, 5).map((b) => b.slug + " | " + b.name + " | " + b.category + " | lat=" + b.coordinates.latitude).join("\n  "));
console.log("\ntotal claimed:", j.pagination.total, "| unclaimed:", j.pagination.unclaimed_total);
