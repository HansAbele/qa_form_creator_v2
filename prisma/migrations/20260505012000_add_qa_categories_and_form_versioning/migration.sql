-- AlterTable
ALTER TABLE "Form" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'DRAFT',
ADD COLUMN "version" TEXT NOT NULL DEFAULT '1.0.0',
ADD COLUMN "publishedAt" TIMESTAMP(3),
ADD COLUMN "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Question" ADD COLUMN "formCategoryId" TEXT,
ADD COLUMN "weight" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "fatal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "requiresCommentOnFail" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Response" ADD COLUMN "formVersion" TEXT,
ADD COLUMN "result" TEXT,
ADD COLUMN "hasFatalFail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'SUBMITTED';

-- AlterTable
ALTER TABLE "Answer" ADD COLUMN "categoryId" TEXT,
ADD COLUMN "score" DECIMAL(5,2),
ADD COLUMN "comment" TEXT,
ADD COLUMN "isFatalFail" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "QACategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "systemColor" TEXT,
    "systemIcon" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "canBeFatal" BOOLEAN NOT NULL DEFAULT false,
    "requiresCommentOnFail" BOOLEAN NOT NULL DEFAULT false,
    "visibleInDashboard" BOOLEAN NOT NULL DEFAULT true,
    "visibleInKPIs" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QACategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormCategory" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "qaCategoryId" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 0,
    "fatalIfFailed" BOOLEAN NOT NULL DEFAULT false,
    "requiresComment" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FormCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QACategory_name_key" ON "QACategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "FormCategory_formId_qaCategoryId_key" ON "FormCategory"("formId", "qaCategoryId");

-- CreateIndex
CREATE INDEX "FormCategory_qaCategoryId_idx" ON "FormCategory"("qaCategoryId");

-- CreateIndex
CREATE INDEX "FormCategory_formId_sortOrder_idx" ON "FormCategory"("formId", "sortOrder");

-- CreateIndex
CREATE INDEX "Question_formCategoryId_idx" ON "Question"("formCategoryId");

-- CreateIndex
CREATE INDEX "Answer_categoryId_idx" ON "Answer"("categoryId");

-- Seed default QA categories
INSERT INTO "QACategory" ("id", "name", "description", "systemColor", "systemIcon", "canBeFatal", "requiresCommentOnFail", "sortOrder", "updatedAt")
VALUES
  ('qa_customer_critical', 'Customer Critical', 'Interacciones que afectan directamente experiencia y satisfaccion del cliente.', '#2563EB', 'heart-handshake', true, true, 10, CURRENT_TIMESTAMP),
  ('qa_business_critical', 'Business Critical', 'Criterios de negocio, proceso y consistencia operativa.', '#F97316', 'briefcase-business', false, false, 20, CURRENT_TIMESTAMP),
  ('qa_compliance_critical', 'Compliance Critical', 'Requisitos regulatorios, privacidad y verificacion obligatoria.', '#DC2626', 'shield-check', true, true, 30, CURRENT_TIMESTAMP),
  ('qa_contact_resolution', 'Contact Resolution', 'Resolucion, cierre y calidad de documentacion del contacto.', '#16A34A', 'circle-check', false, false, 40, CURRENT_TIMESTAMP),
  ('qa_soft_skills', 'Soft Skills', 'Empatia, tono, escucha activa y claridad de comunicacion.', '#7C3AED', 'message-circle-heart', false, false, 50, CURRENT_TIMESTAMP),
  ('qa_process_adherence', 'Process Adherence', 'Adherencia a procedimientos definidos por campana.', '#0891B2', 'list-checks', false, false, 60, CURRENT_TIMESTAMP),
  ('qa_documentation_quality', 'Documentation Quality', 'Calidad y completitud de notas o registros.', '#4B5563', 'file-check', false, false, 70, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

-- AddForeignKey
ALTER TABLE "FormCategory" ADD CONSTRAINT "FormCategory_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormCategory" ADD CONSTRAINT "FormCategory_qaCategoryId_fkey" FOREIGN KEY ("qaCategoryId") REFERENCES "QACategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_formCategoryId_fkey" FOREIGN KEY ("formCategoryId") REFERENCES "FormCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "QACategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
