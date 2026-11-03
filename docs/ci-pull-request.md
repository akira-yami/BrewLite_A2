# CI trên pull request

Workflow `Pull Request CI` chạy với PR vào `main`, push vào `main` và thủ công. Job `Install, lint, unit test and build` yêu cầu Node 22 và mỗi ứng dụng `apps/api`, `apps/web` có `package.json`, `package-lock.json` cùng scripts `lint`, `test` (unit test), `build`. Pipeline kiểm tra cả hai app, sau đó chạy `npm ci`, `npm run lint`, `npm run test`, `npm run build` theo thứ tự; bất kỳ lệnh nào lỗi đều dừng job.

Baseline hiện chưa có package/lockfile, nên bước validate sẽ fail có thông báo thay vì báo pass giả. Khi #21/#22 thêm runtime, nhóm cần thống nhất Node/npm, scripts và cách cài; nếu chọn workspace monorepo hoặc package manager khác, cập nhật workflow và tài liệu này cùng PR.

Để chặn merge, quản trị viên cấu hình branch protection hoặc ruleset cho `main`, yêu cầu pull request và check **Install, lint, unit test and build**; hạn chế quyền bypass phù hợp nhóm. Sau khi check đã xuất hiện trên GitHub, xác minh bằng một PR hợp lệ pass và một thay đổi cố ý làm lint/test fail: PR lỗi không được merge, kể cả khi kiểm tra với tài khoản có quyền bypass. Ghi link hai run và cấu hình/bypass thực tế vào evidence; cấu hình YAML không tự bật branch protection. Các thay đổi thử nghiệm cần được hoàn tác trước khi merge.

Hiện chưa có bằng chứng pass/fail, required check hoặc branch protection. [Issue #24](https://github.com/akira-yami/BrewLite_A2/issues/24) chỉ hoàn tất khi runtime, hai run và cấu hình chặn merge đã được xác minh.
