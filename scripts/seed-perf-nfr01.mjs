import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from '../apps/api/node_modules/bcryptjs/index.js';
import pg from '../apps/api/node_modules/pg/lib/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

// Đọc env nếu chưa có
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(resolve(rootDir, 'apps/api/.env'));
  } catch {}
}

// Connection string from apps/api/.env or environment
const dbUrl = process.env.DATABASE_URL || 'postgresql://brewlite:123456@localhost:5432/brewlite?schema=public';
console.log('Connecting to PostgreSQL database:', dbUrl.replace(/:[^:@]+@/, ':****@'));

const pool = new pg.Pool({ connectionString: dbUrl });

async function seedPerformanceDataset() {
  const client = await pool.connect();
  try {
    console.log('--- BẮT ĐẦU SEED DATASET NFR-01 (100 products, 300 variants, 30 toppings, 1000 orders) ---');

    // 1. Kiểm tra / Đảm bảo các nguyên liệu cốt lõi có tồn kho dồi dào
    console.log('1. Cập nhật số lượng tồn kho nguyên liệu lên 10.000.000 để phục vụ tải...');
    await client.query(`
      UPDATE ingredients
      SET stock_quantity = 10000000
    `);

    // Thêm các nguyên liệu phụ nếu chưa có
    const extraIngredients = [
      { code: 'MATCHA_POWDER', name: 'Bột Matcha Uji', unit: 'G' },
      { code: 'TARO_POWDER', name: 'Bột Khoai Môn', unit: 'G' },
      { code: 'COCOA_POWDER', name: 'Bột Cacao Nguyên Chất', unit: 'G' },
      { code: 'MANGO_PUREE', name: 'Xoài Nghiền Tự Nhiên', unit: 'ML' },
      { code: 'STRAWBERRY_SYRUP', name: 'Siro Dâu Tây', unit: 'ML' },
      { code: 'CARAMEL_SYRUP', name: 'Siro Caramel Muối', unit: 'ML' },
      { code: 'VANILLA_SYRUP', name: 'Siro Vani Madagascar', unit: 'ML' },
      { code: 'SOY_MILK', name: 'Sữa Đậu Nành Hữu Cơ', unit: 'ML' },
      { code: 'OAT_MILK', name: 'Sữa Yến Mạch Barista', unit: 'ML' },
      { code: 'COCONUT_MILK', name: 'Cốt Dừa Tươi Bến Tre', unit: 'ML' },
      { code: 'LOTUS_SEED', name: 'Hạt Sen Huế', unit: 'G' },
      { code: 'CHIA_SEED', name: 'Hạt Chia Úc', unit: 'G' },
    ];

    for (const ing of extraIngredients) {
      await client.query(`
        INSERT INTO ingredients (id, code, name, unit, stock_quantity, created_at, updated_at)
        VALUES ($1, $2, $3, $4::"IngredientUnit", 10000000, NOW(), NOW())
        ON CONFLICT (code) DO UPDATE
        SET stock_quantity = 10000000, updated_at = NOW();
      `, [randomUUID(), ing.code, ing.name, ing.unit]);
    }

    // 2. Tạo đủ 30 Topping theo NFR-01
    console.log('2. Tạo đủ 30 loại Topping...');
    const currentToppingsRes = await client.query('SELECT COUNT(*) FROM toppings');
    const currentToppingsCount = parseInt(currentToppingsRes.rows[0].count, 10);
    console.log(`- Số topping hiện có: ${currentToppingsCount}`);

    const baseToppingNames = [
      'Trân châu trắng 3Q', 'Trân châu đen hoàng kim', 'Thạch phô mai tươi', 'Thạch củ năng giòn',
      'Kem Cheese mặn', 'Kem Macchiato vani', 'Thạch dừa non sợi', 'Thạch sương sáo thanh nhiệt',
      'Hạt sen ngào đường', 'Đậu đỏ Azuki', 'Bánh Flan caramen', 'Pudding trứng béo',
      'Pudding socola', 'Nha đam tươi giòn', 'Hạt chia hữu cơ', 'Trân châu sợi ngọc bích',
      'Thạch matcha ngọc', 'Sốt dâu tây tươi', 'Sốt xoài dừa', 'Vụn bánh Oreo phô mai',
      'Hạnh nhân rang lát', 'Dừa nướng giòn rụm', 'Trân châu củ dền hồng', 'Thạch trà đen ô long',
      'Trân châu đường nâu hổ phách', 'Kem trứng nướng cháy', 'Pudding khoai môn dẻo',
      'Thạch đào miếng', 'Trân châu hoa đậu biếc', 'Thạch khúc bạch phô mai'
    ];

    for (let i = currentToppingsCount; i < 30; i++) {
      const code = `TOP_NFR_${String(i + 1).padStart(2, '0')}`;
      const name = baseToppingNames[i] || `Topping Đặc Biệt #${i + 1}`;
      const price = (5000 + (i % 7) * 1000);
      const toppingId = randomUUID();

      await client.query(`
        INSERT INTO toppings (id, code, name, type, price, is_active, created_at, updated_at)
        VALUES ($1, $2, $3, 'PREPACKAGED'::"ToppingType", $4, true, NOW(), NOW())
        ON CONFLICT (code) DO NOTHING;
      `, [toppingId, code, name, price]);
    }

    const updatedToppingsRes = await client.query('SELECT COUNT(*) FROM toppings');
    console.log(`- Số topping sau khi seed: ${updatedToppingsRes.rows[0].count}`);

    // 3. Tạo đủ 100 Sản phẩm (Products) và 300 Biến thể (Variants)
    console.log('3. Đảm bảo đủ 100 Sản phẩm và 300 Biến thể (S, M, L)...');
    const currentProdRes = await client.query('SELECT COUNT(*) FROM products');
    const currentProdCount = parseInt(currentProdRes.rows[0].count, 10);
    console.log(`- Số sản phẩm hiện có: ${currentProdCount}`);

    const categories = ['Cà phê Pha Máy', 'Cà phê Ủ Lạnh', 'Trà Trái Cây', 'Trà Sữa Ô Long', 'Đá Xay & Sinh Tố'];
    const productTemplates = [
      'Espresso Đậm Đà', 'Americano Cổ Điển', 'Cappuccino Bọt Mịn', 'Latte Hạnh Nhân',
      'Mocha Socola Đen', 'Caramel Macchiato', 'Cold Brew Truyền Thống', 'Cold Brew Cam Vàng',
      'Cold Brew Mật Ong', 'Cold Brew Sữa Yến Mạch', 'Trà Đào Cam Sả', 'Trà Vải Hoa Lài',
      'Trà Dâu Tây Nhiệt Đới', 'Trà Xoài Chanh Leo', 'Trà Ô Long Sen Vàng', 'Trà Ô Long Sữa Nướng',
      'Trà Sữa Trân Châu Đen', 'Trà Sữa Matcha Uji', 'Trà Sữa Khoai Môn', 'Matcha Đá Xay Kem Cheese',
      'Socola Đá Xay Bạc Hà', 'Cà Phê Đá Xay Hạt Dẻ', 'Sinh Tố Bơ Cốt Dừa', 'Sinh Tố Xoài Chuối',
    ];

    // Seed thêm sản phẩm để đạt đúng 100 products
    for (let i = currentProdCount; i < 100; i++) {
      const sku = `PROD-NFR-${String(i + 1).padStart(3, '0')}`;
      const baseName = productTemplates[i % productTemplates.length];
      const name = `${baseName} (Phiên bản ${Math.floor(i / productTemplates.length) + 1})`;
      const category = categories[i % categories.length];
      const description = `Thức uống pha chế chất lượng cao ${name}, phục vụ nhanh chóng tại BrewLite.`;
      const imageUrl = `/products/product-${(i % 12) + 1}.webp`;
      const productId = randomUUID();

      await client.query(`
        INSERT INTO products (id, sku, name, description, image_url, is_active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW())
        ON CONFLICT (sku) DO NOTHING;
      `, [productId, sku, name, description, imageUrl]);

      // Lấy lại ID sản phẩm
      const pRes = await client.query('SELECT id FROM products WHERE sku = $1', [sku]);
      const actualProdId = pRes.rows[0].id;

      // Tạo 3 variants: S, M, L cho sản phẩm này
      const sizes = [
        { size: 'S', price: 30000 + (i % 10) * 1000 },
        { size: 'M', price: 35000 + (i % 10) * 1000 },
        { size: 'L', price: 40000 + (i % 10) * 1000 },
      ];

      for (const v of sizes) {
        await client.query(`
          INSERT INTO product_variants (id, product_id, size, price, is_active, created_at, updated_at)
          VALUES ($1, $2, $3::"ProductSize", $4, true, NOW(), NOW())
          ON CONFLICT (product_id, size) DO UPDATE SET price = $4, updated_at = NOW();
        `, [randomUUID(), actualProdId, v.size, v.price]);
      }
    }

    // Đảm bảo đủ 100 sản phẩm và >= 300 variants
    const allProds = await client.query('SELECT id, sku FROM products LIMIT 120');
    for (const p of allProds.rows) {
      for (const size of ['S', 'M', 'L']) {
        await client.query(`
          INSERT INTO product_variants (id, product_id, size, price, is_active, created_at, updated_at)
          VALUES ($1, $2, $3::"ProductSize", 35000, true, NOW(), NOW())
          ON CONFLICT (product_id, size) DO NOTHING;
        `, [randomUUID(), p.id, size]);
      }
    }

    // 3b. Gán công thức (recipe_items) cho variant chưa có.
    // OrdersService coi variant không có công thức là hết hàng (OUT_OF_STOCK, HTTP 409),
    // nên variant seed thêm phải có công thức mới đặt được.
    // Mỗi variant mới sao chép công thức của một variant cùng size đã có công thức (chọn xoay vòng theo hash)
    // để tải được phân tán trên nhiều tổ hợp nguyên liệu.
    console.log('3b. Gán công thức cho variant chưa có công thức...');
    const recipeRes = await client.query(`
      INSERT INTO recipe_items (product_variant_id, ingredient_id, quantity)
      SELECT pv.id, r.ingredient_id, r.quantity
      FROM product_variants pv
      JOIN LATERAL (
        SELECT t.id
        FROM product_variants t
        WHERE t.size = pv.size
          AND EXISTS (SELECT 1 FROM recipe_items x WHERE x.product_variant_id = t.id)
        ORDER BY md5(pv.id::text || t.id::text)
        LIMIT 1
      ) tpl ON true
      JOIN recipe_items r ON r.product_variant_id = tpl.id
      WHERE pv.is_active = true
        AND NOT EXISTS (SELECT 1 FROM recipe_items y WHERE y.product_variant_id = pv.id)
      ON CONFLICT DO NOTHING
    `);
    console.log(`- Đã thêm ${recipeRes.rowCount} dòng công thức.`);
    const noRecipeRes = await client.query(`
      SELECT count(*)::int AS n FROM product_variants pv
      WHERE pv.is_active = true AND NOT EXISTS (SELECT 1 FROM recipe_items r WHERE r.product_variant_id = pv.id)
    `);
    console.log(`- Variant đang bán nhưng chưa có công thức: ${noRecipeRes.rows[0].n}`);

    // 4. Tạo các tài khoản test user để phục vụ tải
    console.log('4. Kiểm tra tài khoản test user...');
    const passwordHash = await bcrypt.hash('Customer@123', 10);
    const testUsers = ['customer01', 'perf_user_01', 'perf_user_02', 'perf_user_03', 'perf_user_04', 'perf_user_05'];
    const userIds = [];

    for (const u of testUsers) {
      const uRes = await client.query(`
        INSERT INTO users (id, username, password_hash, role, is_active, created_at, updated_at)
        VALUES ($1, $2, $3, 'CUSTOMER'::"UserRole", true, NOW(), NOW())
        ON CONFLICT (username) DO UPDATE SET password_hash = $3, is_active = true
        RETURNING id;
      `, [randomUUID(), u, passwordHash]);
      userIds.push(uRes.rows[0].id);
    }
    console.log(`- Đã sẵn sàng ${userIds.length} test users`);

    // 5. Tạo đủ 1.000 đơn hàng lịch sử (Orders) theo NFR-01
    console.log('5. Tạo 1.000 đơn hàng lịch sử...');
    const currentOrdersRes = await client.query('SELECT COUNT(*) FROM orders');
    let currentOrdersCount = parseInt(currentOrdersRes.rows[0].count, 10);
    console.log(`- Số đơn hàng hiện có: ${currentOrdersCount}`);

    const variantsRes = await client.query(`
      SELECT pv.id, pv.price, pv.size, p.name as product_name
      FROM product_variants pv
      JOIN products p ON pv.product_id = p.id
      LIMIT 100
    `);
    const availableVariants = variantsRes.rows;

    const neededOrders = Math.max(0, 1000 - currentOrdersCount);
    console.log(`- Cần tạo thêm: ${neededOrders} đơn hàng để đạt 1.000 đơn...`);

    if (neededOrders > 0) {
      const batchSize = 100;
      for (let batch = 0; batch < neededOrders; batch += batchSize) {
        const count = Math.min(batchSize, neededOrders - batch);
        for (let j = 0; j < count; j++) {
          const orderIdx = currentOrdersCount + batch + j + 1;
          const orderId = randomUUID();
          const orderNumber = `ORD-PERF-${String(orderIdx).padStart(6, '0')}`;
          const userId = userIds[orderIdx % userIds.length];
          const variant = availableVariants[orderIdx % availableVariants.length];
          const qty = 1 + (orderIdx % 3);
          const itemPrice = parseInt(variant.price, 10);
          const totalAmount = itemPrice * qty;

          // Tạo Order
          await client.query(`
            INSERT INTO orders (id, order_number, user_id, status, subtotal, discount_amount, total, reservation_expires_at, created_at, updated_at)
            VALUES ($1, $2, $3, 'COMPLETED'::"OrderStatus", $4, 0, $4, NOW() + INTERVAL '1 day', NOW() - INTERVAL '1 day' * ($5 % 30), NOW())
          `, [orderId, orderNumber, userId, totalAmount, orderIdx]);

          // Tạo Order Item
          const orderItemId = randomUUID();
          await client.query(`
            INSERT INTO order_items (id, order_id, product_variant_id, product_name_snapshot, variant_name_snapshot, quantity, unit_price, sugar_level, ice_level)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 100, 100)
          `, [orderItemId, orderId, variant.id, variant.product_name, `Size ${variant.size}`, qty, itemPrice]);

          // Tạo Order Status History
          await client.query(`
            INSERT INTO order_status_histories (id, order_id, from_status, to_status, created_at)
            VALUES ($1, $2, 'PAID'::"OrderStatus", 'COMPLETED'::"OrderStatus", NOW())
          `, [randomUUID(), orderId]);
        }
        process.stdout.write(`  Đã tạo ${batch + count}/${neededOrders} đơn...\r`);
      }
      console.log('\n- Hoàn tất tạo 1.000 đơn hàng lịch sử!');
    }

    // 6. Kiểm tra lại toàn bộ tổng số bản ghi
    const [finalP, finalV, finalT, finalO, finalU] = await Promise.all([
      client.query('SELECT count(*) FROM products'),
      client.query('SELECT count(*) FROM product_variants'),
      client.query('SELECT count(*) FROM toppings'),
      client.query('SELECT count(*) FROM orders'),
      client.query('SELECT count(*) FROM users'),
    ]);

    console.log('\n======================================================');
    console.log('   TỔNG KẾT DATASET HIỆU NĂNG THEO ĐIỀU KIỆN SRS NFR-01');
    console.log('======================================================');
    console.log(`- Products         : ${finalP.rows[0].count} (Mục tiêu SRS: >= 100)`);
    console.log(`- Product Variants : ${finalV.rows[0].count} (Mục tiêu SRS: >= 300)`);
    console.log(`- Toppings         : ${finalT.rows[0].count} (Mục tiêu SRS: >= 30)`);
    console.log(`- Orders           : ${finalO.rows[0].count} (Mục tiêu SRS: >= 1.000)`);
    console.log(`- Users            : ${finalU.rows[0].count}`);
    console.log('======================================================\n');

  } catch (err) {
    console.error('Lỗi khi seed dataset hiệu năng:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seedPerformanceDataset().catch((err) => {
  console.error(err);
  process.exit(1);
});
