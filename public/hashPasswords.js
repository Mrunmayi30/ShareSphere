const bcrypt = require("bcrypt");
const db = require("./config/db");

db.query("SELECT id, password FROM users", async (err, results) => {
  if (err) throw err;

  for (let user of results) {
    const hashed = await bcrypt.hash(user.password, 10);
    db.query("UPDATE users SET password=? WHERE id=?", [hashed, user.id]);
  }

  console.log("All passwords hashed!");
  db.end();
});