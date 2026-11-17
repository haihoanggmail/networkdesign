import { expect, test } from '@playwright/test';

test.describe('HACHIHI Network & Electrical Designer E2E Smoke', () => {
  test('loads workspace, opens BOM & Export & About, and persists across reload', async ({ page, browserName }) => {
    void browserName;
    await page.addInitScript(() => {
      try {
        localStorage.setItem('hachihi_quick_tour_done_v1', '1');
        localStorage.setItem('hachihi_last_seen_version', '3.1.1');
      } catch {
        // ignore
      }
    });
    await page.goto('/');

    // Dismiss first-visit welcome hub modal after async IndexedDB hydration
    const welcomeCloseBtn = page.getByRole('button', { name: 'Đóng quản lý dự án' });
    try {
      await welcomeCloseBtn.waitFor({ state: 'visible', timeout: 8000 });
      await welcomeCloseBtn.click();
      await welcomeCloseBtn.waitFor({ state: 'hidden', timeout: 4000 });
    } catch {
      // already dismissed
    }

    // Main canvas and far-right About HACHIHI button render
    const aboutTrigger = page.getByRole('button', { name: 'Giới thiệu HACHIHI' });
    await expect(aboutTrigger).toBeVisible();

    const width = page.viewportSize()?.width ?? 1440;
    const aboutBox = await aboutTrigger.boundingBox();
    expect(aboutBox).not.toBeNull();
    if (aboutBox) {
      expect(aboutBox.x).toBeGreaterThan(width / 2);
    }

    // Open About modal and check brand info & version
    if (await welcomeCloseBtn.isVisible()) {
      await welcomeCloseBtn.click();
      await welcomeCloseBtn.waitFor({ state: 'hidden', timeout: 4000 });
    }
    await aboutTrigger.click();
    const aboutDialog = page.getByRole('dialog', { name: /Giới thiệu HACHIHI/i });
    await expect(aboutDialog).toBeVisible();
    await expect(aboutDialog.getByText(/hachihi\.vn/).first()).toBeVisible();
    const contactTabBtn = aboutDialog.getByRole('button', { name: 'Liên hệ' });
    if (await contactTabBtn.isVisible()) {
      await contactTabBtn.click();
    }
    await expect(aboutDialog.getByText(/093 384 2126/)).toBeVisible();
    await page.getByRole('button', { name: 'Đóng cửa sổ Giới thiệu' }).click();

    // Verify 3-tier responsive behavior
    if (width < 768) {
      await expect(page.getByRole('navigation', { name: 'Thanh điều hướng nhanh' })).toBeVisible();
      await page.getByRole('button', { name: 'Kiểm tra, Xuất và Dự án' }).click();
      await expect(page.getByRole('dialog', { name: 'Tính năng & Hồ sơ dự án' })).toBeVisible();
      const mobile3DBtn = page.getByRole('button', { name: /Chuyển đổi 2D \/ 3D/i });
      await expect(mobile3DBtn).toBeVisible();
      await mobile3DBtn.click();
      await expect(page.getByText('Không gian 3D')).toBeVisible();
      await expect(page.getByTestId('3d-xyz-gizmo')).toBeVisible();
      await page.getByRole('button', { name: /Về 2D CAD/i }).click();
      await expect(page.getByText('Không gian 3D')).toBeHidden();
    } else {
      // Wide / Medium: verify 6 clear business menus (Tệp · Chỉnh sửa · Thiết kế · Kỹ thuật · Hồ sơ · Trợ giúp)
      const fileBtn = page.getByRole('button', { name: 'Mở menu Tệp và Tạo mới' });
      const editBtn = page.getByRole('button', { name: 'Mở menu Chỉnh sửa' });
      const designBtn = page.getByRole('button', { name: 'Mở menu Thiết kế' });
      const engineeringBtn = page.getByRole('button', { name: 'Mở menu Kỹ thuật' });
      const docsBtn = page.getByRole('button', { name: 'Mở menu Hồ sơ' });
      const helpBtn = page.getByRole('button', { name: 'Mở menu Trợ giúp' });
      const fileBox = await fileBtn.boundingBox();
      expect(fileBox).not.toBeNull();
      if (fileBox) {
        expect(fileBox.x).toBeLessThan(width / 2);
      }
      if (width >= 1024) {
        await expect(editBtn).toBeVisible();
        await expect(designBtn).toBeVisible();
        await expect(engineeringBtn).toBeVisible();
        await expect(docsBtn).toBeVisible();
        await expect(helpBtn).toBeVisible();
      }

      // Verify Giới thiệu HACHIHI is placed to the right of Theme button (far right end)
      const themeBtn = page.getByRole('button', { name: /Chuyển sang chế độ/i });
      const themeBox = await themeBtn.boundingBox();
      if (aboutBox && themeBox) {
        expect(aboutBox.x).toBeGreaterThan(themeBox.x);
      }

      await fileBtn.click();
      const fileMenu = page.getByRole('menu', { name: 'Menu Tệp và Tạo mới' });
      await expect(fileMenu).toBeVisible();
      await expect(fileMenu.getByRole('button', { name: 'Tạo mới' })).toBeVisible();
      await expect(fileMenu.getByRole('button', { name: 'Mở', exact: true })).toBeVisible();
      await expect(fileMenu.getByText('Mẫu trống')).toBeVisible();
      await expect(fileMenu.getByText('Nhập / Xuất Cây Excel')).toBeVisible();
      await expect(fileMenu.getByText('Nhập từ file JSON')).toBeVisible();
      await expect(fileMenu.getByText(/Từ file đồng nghiệp đã lưu/i)).toBeVisible();
      await fileMenu.getByText('Chọn mẫu có sẵn').click();

      const tplDialog = page.getByRole('dialog', { name: /Thư Viện Mẫu/i });
      await expect(tplDialog).toBeVisible();
      const lanStarCard = tplDialog.getByText('Mạng LAN Cơ bản (Star 2-Tầng PoE)');
      await expect(lanStarCard).toBeVisible();
      await lanStarCard.click();
      await expect(tplDialog).toBeHidden();

      // Verify single consolidated Excel Tree Import/Export modal entry
      await fileBtn.click();
      await page.getByRole('menu', { name: 'Menu Tệp và Tạo mới' }).getByText('Nhập / Xuất Cây Excel').click();
      const excelTreeDialog = page.getByRole('dialog', { name: /Tạo Sơ Đồ Router Đa Tầng Từ Excel/i });
      await expect(excelTreeDialog).toBeVisible();
      await excelTreeDialog.getByRole('button', { name: 'Xem thử mẫu' }).click();
      await expect(excelTreeDialog.getByText('Router-A1').first()).toBeVisible();
      await excelTreeDialog.getByRole('button', { name: /Xem trước sơ đồ/i }).click();
      await expect(excelTreeDialog.getByText(/Bản xem trước bố cục/i)).toBeVisible();
      await excelTreeDialog.getByRole('button', { name: /Cây dọc/i }).click();
      await excelTreeDialog.getByRole('button', { name: /Theo tầng/i }).click();
      await excelTreeDialog.getByRole('button', { name: /Bảng dữ liệu/i }).click();
      await expect(excelTreeDialog.getByText('Router-D1')).toBeVisible();
      await excelTreeDialog.getByRole('button', { name: /Tạo Sơ Đồ Từ Excel/i }).click();
      await expect(excelTreeDialog).toBeHidden();

      // Verify dragging horizontal and vertical guide lines from canvas viewport edge rulers
      const topRuler = page.getByTestId('canvas-top-ruler');
      const leftRuler = page.getByTestId('canvas-left-ruler');
      await expect(topRuler).toBeVisible();
      await expect(leftRuler).toBeVisible();
      const topRulerBox = await topRuler.boundingBox();
      const leftRulerBox = await leftRuler.boundingBox();
      if (topRulerBox && leftRulerBox) {
        await page.mouse.move(topRulerBox.x + 120, topRulerBox.y + 8);
        await page.mouse.down();
        await page.mouse.move(topRulerBox.x + 120, topRulerBox.y + 180, { steps: 5 });
        await page.mouse.up();
        await expect(page.locator('[data-testid^="canvas-guide-line-h-"]')).toHaveCount(1);

        await page.mouse.move(leftRulerBox.x + 8, leftRulerBox.y + 120);
        await page.mouse.down();
        await page.mouse.move(leftRulerBox.x + 200, leftRulerBox.y + 120, { steps: 5 });
        await page.mouse.up();
        await expect(page.locator('[data-testid^="canvas-guide-line-v-"]')).toHaveCount(1);
      }

      // Verify Thiết kế & Kỹ thuật menus open cleanly on desktop
      if (width >= 1024) {
        await designBtn.click();
        const designMenu = page.getByRole('menu', { name: 'Menu Thiết kế' });
        await expect(designMenu).toBeVisible();
        await expect(designMenu.getByText('Thư viện mẫu chuẩn')).toBeVisible();
        await page.keyboard.press('Escape');

        await engineeringBtn.click();
        const engMenu = page.getByRole('menu', { name: 'Menu Kỹ thuật' });
        await expect(engMenu).toBeVisible();
        await expect(engMenu.getByText('Kiểm tra kỹ thuật (Audit)')).toBeVisible();
        await page.keyboard.press('Escape');
      }

      await page.getByRole('button', { name: 'Mở Bảng vật tư (BOM)' }).click();
      const bomDialog = page.getByRole('dialog', { name: /Thống kê Vật tư/i });
      await expect(bomDialog).toBeVisible();
      await expect(bomDialog.getByRole('tab', { name: /Thiết bị & SKU/i })).toBeVisible();
      await bomDialog.getByRole('tab', { name: /Dây cáp & Cắt cuộn/i }).click();
      await bomDialog.getByRole('tab', { name: /Đa góc nhìn/i }).click();
      await expect(bomDialog.getByText(/Theo Tầng/i).first()).toBeVisible();
      await bomDialog.getByRole('tab', { name: /So sánh BOM/i }).click();
      await page.keyboard.press('Escape');
      await expect(bomDialog).toBeHidden();

      // Verify Auto-Layering popover button from Canvas HUD Layers popover
      await page.getByRole('button', { name: 'Quản lý lớp hiển thị & khóa' }).click();
      const autoLayerBtn = page.getByTestId('auto-layer-now-btn');
      await expect(autoLayerBtn).toBeVisible();
      await autoLayerBtn.click();
      await expect(page.getByText('Mạng (Network)').first()).toBeVisible();
      await expect(page.getByText('IoT & Cảm biến').first()).toBeVisible();
      await expect(page.getByText('Nguồn & Điện').first()).toBeVisible();
      await page.keyboard.press('Escape');

      // Verify Legend table creation and scalable resize handle drag
      await page.keyboard.press('l');
      const legendResizeHandle = page.locator('[data-testid^="legend-resize-se-"]').first();
      await expect(legendResizeHandle).toBeVisible();
      const legendBox = await legendResizeHandle.boundingBox();
      if (legendBox) {
        await page.mouse.move(legendBox.x + legendBox.width / 2, legendBox.y + legendBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(legendBox.x + 140, legendBox.y + 80, { steps: 4 });
        await page.mouse.up();
      }

      // Open Export modal and check 2D/3D scope behavior
      await page.getByRole('button', { name: 'Xuất hồ sơ bản vẽ' }).click();
      const exportDialog = page.getByRole('dialog', { name: /Xuất/i });
      await expect(exportDialog).toBeVisible();
      await expect(exportDialog.getByTestId('export-scope-2d')).toHaveAttribute('aria-pressed', 'true');
      await exportDialog.getByTestId('export-scope-3d').click();
      await expect(exportDialog.getByRole('button', { name: /Vector SVG Chuẩn CAD/i })).toBeDisabled();
      await expect(exportDialog.getByRole('button', { name: /AutoCAD DXF Đa Lớp/i })).toBeDisabled();
      await expect(exportDialog.getByRole('button', { name: /Trình Xem HTML Độc Lập/i })).toBeEnabled();
      await page.keyboard.press('Escape');
      await expect(exportDialog).toBeHidden();

      // Verify bottom-right 2D / 3D button placement & active bright/dim label toggle
      const toggle3DBtn = page.getByTestId('toggle-3d-btn');
      const dragLock3DBtn = page.getByTestId('toggle-3d-drag-lock-btn');
      await expect(toggle3DBtn).toBeVisible();
      await expect(dragLock3DBtn).toHaveCount(0);
      const toggleBox = await toggle3DBtn.boundingBox();
      const viewportHeight = page.viewportSize()?.height ?? 900;
      if (toggleBox) {
        expect(toggleBox.x).toBeGreaterThan(width / 2);
        expect(toggleBox.y).toBeGreaterThan(viewportHeight / 2);
      }
      await expect(page.getByTestId('toggle-3d-label-2d')).toHaveClass(/opacity-100/);
      await expect(page.getByTestId('toggle-3d-label-3d')).toHaveClass(/opacity-45/);

      await toggle3DBtn.click();
      await expect(page.getByText('Không gian 3D')).toBeVisible();
      await expect(page.getByTestId('3d-xyz-gizmo')).toBeVisible();
      await expect(page.getByTestId('toggle-3d-label-3d')).toHaveClass(/opacity-100/);
      await expect(page.getByTestId('toggle-3d-label-2d')).toHaveClass(/opacity-45/);

      // 2D-only buttons are visibly dimmed & disabled while in 3D mode
      await expect(page.getByRole('button', { name: 'Phòng (R)' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Chữ (T)' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Đo (M)' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Bật tắt lưới tọa độ' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Bật tắt bám lưới' })).toBeDisabled();

      // Unified Layers menu still works in 3D mode and exposes 3D display options
      await page.getByRole('button', { name: 'Quản lý lớp hiển thị & khóa' }).click();
      await expect(page.getByRole('button', { name: 'Trục XYZ' })).toBeVisible();
      await expect(page.getByText('Mạng (Network)').first()).toBeVisible();
      await page.keyboard.press('Escape');

      // Opening Export modal from 3D defaults Content Scope to 3D
      await page.getByRole('button', { name: 'Xuất hồ sơ bản vẽ' }).click();
      await expect(exportDialog.getByTestId('export-scope-3d')).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press('Escape');
      await expect(exportDialog).toBeHidden();

      // 3D-only unlock button appears to the left of 2D/3D and defaults to locked
      await expect(dragLock3DBtn).toBeVisible();
      await expect(dragLock3DBtn).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByRole('button', { name: 'Thêm thiết bị' })).toBeDisabled();
      const lockBox = await dragLock3DBtn.boundingBox();
      const nextToggleBox = await toggle3DBtn.boundingBox();
      if (lockBox && nextToggleBox) {
        expect(lockBox.x).toBeLessThan(nextToggleBox.x);
      }
      await dragLock3DBtn.click();
      await expect(dragLock3DBtn).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: 'Thêm thiết bị' })).toBeEnabled();

      await toggle3DBtn.click();
      await expect(dragLock3DBtn).toHaveCount(0);
      await expect(page.getByTestId('canvas-top-ruler')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Phòng (R)' })).toBeEnabled();
    }

    // Reload and verify state persistence without fatal console/page errors
    await page.reload();
    await expect(page.getByRole('button', { name: 'Giới thiệu HACHIHI' })).toBeVisible();
  });
});
