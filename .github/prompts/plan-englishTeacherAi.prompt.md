# Architecture Plan: EnglishTeacherAI (ESP32-S3 N16R8)

## 1. Project Tree (Component-based Structure)
Dự án tuân thủ nghiêm ngặt mô hình tách biệt logic của ESP-IDF, giúp dễ dàng bảo trì và mở rộng.

```text
EnglishTeacherAI/
├── components/
│   ├── wifi_service/       # Quản lý Wi-Fi, Event Group và WebSocket Client
│   │   ├── include/
│   │   ├── wifi_service.c
│   │   └── CMakeLists.txt
│   ├── audio_service/      # Quản lý I2S (MAX98357A), Ring Buffers, Audio Pipeline
│   │   ├── include/
│   │   ├── audio_service.c
│   │   └── CMakeLists.txt
│   ├── ui_service/         # LVGL setup, Display Driver (SPI), UI Screens
│   │   ├── include/
│   │   ├── ui_service.c
│   │   └── CMakeLists.txt
│   └── board_support/      # Khởi tạo GPIO, Button (Interrupt-driven), Flash/PSRAM config
│       ├── include/
│       ├── board_support.c
│       └── CMakeLists.txt
├── main/
│   ├── main.c              # Khởi tạo hệ thống và điều phối các Service
│   └── CMakeLists.txt
├── partitions.csv           # Phân vùng tùy chỉnh cho 16MB Flash
├── CMakeLists.txt
└── sdkconfig                # Cấu hình hệ thống
```

## 2. Cấu hình SDKCONFIG (Bắt buộc cho N16R8)
Để khai thác tối đa 16MB Flash và 8MB Octal PSRAM, các tham số sau cần được cấu hình qua `menuconfig`:

### A. Flash & Partition (16MB QSPI)
- `CONFIG_ESPTOOLPY_FLASHSIZE_16MB=y`: Nhận diện đủ 16MB.
- `CONFIG_PARTITION_TABLE_CUSTOM=y`: Sử dụng file `partitions.csv` để tối ưu vùng lưu trữ (OTA, Storage, UI Assets).
- `CONFIG_ESPTOOLPY_FLASHMODE_QIO=y`: Tốc độ truy xuất Flash tối đa.

### B. PSRAM (8MB Octal)
- `CONFIG_SPIRAM=y`: Kích hoạt hỗ trợ RAM ngoài.
- `CONFIG_SPIRAM_MODE_OCT=y`: **Bắt buộc** cho bản N16R8 (Octal PSRAM).
- `CONFIG_SPIRAM_SPEED_80M=y`: Tốc độ PSRAM tối đa.
- `CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL=n`: Cho phép `malloc` cấp phát tự động vào PSRAM nếu buffer lớn.
- `CONFIG_SPIRAM_MALLOC_RESERVE_INTERNAL=32768`: Giữ lại 32KB RAM nội cho các task yêu cầu tốc độ cực cao (như I2S DMA).

## 3. Phân bổ FreeRTOS Tasks
Đảm bảo tính Non-blocking giữa xử lý âm thanh (High priority) và UI/Network.

| Task Name | Priority | Core | Stack Size | Ghi chú |
| :--- | :--- | :--- | :--- | :--- |
| `wifi_ws_task` | 5 | 0 | 8KB | Xử lý gói tin WebSocket và Network Stack. |
| `audio_i2s_task`| 15 | 1 | 16KB | **High Priority**. Xử lý DMA I2S, Audio Decoding. Buffer nằm trên PSRAM. |
| `ui_lvgl_task`  | 4 | 1 | 16KB | Render UI. LVGL Draw Buffers đặt trên PSRAM để tiết kiệm Internal RAM. |
| `btn_handler`   | 2 | 0 | 4KB | Xử lý ngắt nút nhấn và điều hướng trạng thái máy (FSM). |

## 4. Bảng dự kiến Pinout Mapping (GPIO)
Dựa trên kiến trúc ESP32-S3, các chân sau được chọn để tối ưu đường đi tín hiệu:

### I2S Audio (MAX98357A - Output)
| Chân MAX98357A | Chân ESP32-S3 | Ghi chú |
| :--- | :--- | :--- |
| **BCLK** | GPIO 1 | Bit Clock |
| **LRCK** | GPIO 2 | Word Select |
| **DIN** | GPIO 42 | Data In |
| **GND/VCC** | GND / 5V | |

### SPI Display (TFT)
| Chân Màn Hình | Chân ESP32-S3 | Ghi chú |
| :--- | :--- | :--- |
| **SCL (SCK)** | GPIO 12 | SPI2 (FSPI) |
| **SDA (MOSI)**| GPIO 11 | SPI2 (FSPI) |
| **CS** | GPIO 10 | Chip Select |
| **DC** | GPIO 9 | Data/Command |
| **RST** | GPIO 14 | Reset |
| **BL** | GPIO 21 | Backlight (PWM control) |

### Input & Others
| Linh kiện | Chân ESP32-S3 | Ghi chú |
| :--- | :--- | :--- |
| **Button** | GPIO 0 | Sử dụng Boot Button có sẵn hoặc GPIO 41 (Internal Pull-up) |
| **I2C (Option)**| SDA (G8), SCL (G18) | Dự phòng cho Cảm biến/Mic I2C nếu cần |

---
**CHỜ PHẢN HỒI:** Vui lòng xác nhận bằng lệnh **"CHỐT KIẾN TRÚC"** để tôi bắt đầu triển khai code cho Component đầu tiên (`board_support` và cấu hình PSRAM).
