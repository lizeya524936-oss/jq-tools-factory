/**
 * Cloudflare Pages 部署清理脚本
 * 部署后自动删除旧部署，只保留最新一个
 * 用法: node scripts/cleanup-deployments.js <project-name>
 */
import { execSync } from 'child_process';

const projectName = process.argv[2];
if (!projectName) {
  console.error('Usage: node scripts/cleanup-deployments.js <project-name>');
  process.exit(1);
}

try {
  const output = execSync(
    `npx wrangler pages deployment list --project-name=${projectName}`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  );

  // 从表格输出中提取部署 ID（UUID 格式，在第二列）
  const idRegex = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;
  const ids = [...output.matchAll(idRegex)].map(m => m[1]);

  if (ids.length <= 1) {
    console.log('Only one deployment found, nothing to clean up.');
    process.exit(0);
  }

  // 跳过第一个（最新的），删除其余
  const toDelete = ids.slice(1);
  console.log(`Keeping latest: ${ids[0]}`);
  console.log(`Deleting ${toDelete.length} old deployment(s)...`);

  for (const id of toDelete) {
    try {
      execSync(
        `npx wrangler pages deployment delete ${id} --project-name=${projectName} --force`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      console.log(`  Deleted: ${id}`);
    } catch (e) {
      console.error(`  Failed to delete ${id}: ${e.stderr || e.message}`);
    }
  }

  console.log('Cleanup complete.');
} catch (e) {
  console.error('Failed to list deployments:', e.stderr || e.message);
  process.exit(1);
}
