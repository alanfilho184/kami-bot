/*
  Warnings:

  - A unique constraint covering the columns `[name,language]` on the table `resources` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "resources_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "resources_name_language_key" ON "resources"("name", "language");
