const { PrismaClient } = require("@prisma/client");
const argon2 = require("argon2");

const prisma = new PrismaClient();

async function main() {
  const hash = await argon2.hash("monmotdepasse");

  const user = await prisma.user.create({
    data: {
      username: "test2",
      passwordHash: hash,

      firstName: "Alex",
      lastName: "Test",

      phone: "0600000000",

      category: "N",
      role: "USER",
    },
  });

  console.log(user);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());