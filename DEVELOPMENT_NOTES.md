# EnglishTeacherAI — Ghi chú phát triển & Kế hoạch triển khai

## Đánh giá lại: Code tự viết vs xiaozhi-esp32

### Bảng so sánh chi tiết

| Mục trong code hiện tại | Trạng thái | xiaozhi-esp32 đã có | Kết luận |
|:-------------------------|:-----------|:---------------------|:---------|
| `board_support` 30% — chỉ check PSRAM + GPIO 0 | Skeleton | `Board` base class + `WifiBoard` + 60+ board configs, button, knob, I2C, backlight, power manager, sleep timer | Bỏ, dùng xiaozhi |
| `wifi_service` 5% — chưa có WiFi STA | Skeleton | `WifiBoard`: auto connect, config AP, SmartConfig/BluFi, reconnect timer, power save | Bỏ, dùng xiaozhi |
| `audio_service` 5% — chưa có I2S | Skeleton | `AudioService` + `AudioCodec`: I2S, Opus encode/decode, resampling, ring buffer, VAD, wake word, AEC, 8+ codec drivers (ES8311, ES8388, MAX98357...) | Bỏ, dùng xiaozhi |
| `ui_service` 5% — chưa có LVGL | Skeleton | `Display` → `LcdDisplay` / `OledDisplay` / `LvglDisplay`: LVGL port, emoji, gif/jpg decoder, theme, font, status bar | Bỏ, dùng xiaozhi |
| Tự viết FSM: IDLE→LISTENING→PROCESSING→SPEAKING | Chưa có | `DeviceStateMachine` + `DeviceState` enum: 11 states (Starting, WifiConfiguring, Idle, Connecting, Listening, Speaking, Upgrading, Activating, AudioTesting, FatalError) | Bỏ, dùng xiaozhi |
| Tự viết WebSocket client | Chưa có | `WebSocketProtocol` + `MqttProtocol`: binary protocol, audio channel, JSON messaging, error handling, timeout | Bỏ, dùng xiaozhi |
| GPIO pinout cũ (SCK=12, MOSI=11, CS=10...) | Không đúng | Board config.h định nghĩa pin cho từng board, thực tế dùng MOSI=41, SCK=42, CS=38... | Cần tạo custom board |
| Chưa có OTA | Thiếu | `Ota` class: firmware download, flash, verify, rollback | Có sẵn |
| Chưa có MCP | Thiếu | `McpServer`: tool registry, JSON-RPC, IoT control | Có sẵn |
| Chưa có wake word | Thiếu | `WakeWord` → `EspWakeWord` / `AfeWakeWord` / `CustomWakeWord` | Có sẵn |
| Chưa có Opus codec | Thiếu | Opus encoder/decoder tích hợp, configurable bitrate/frame duration | Có sẵn |
| Chưa có multi-language | Thiếu | 30+ locale với OGG audio assets (en-US, vi-VN, zh-CN...) | Có sẵn |

### Kết luận

**Code hiện tại (skeleton C) nên được thay thế hoàn toàn bằng xiaozhi-esp32.**

Lý do:
- xiaozhi-esp32 (24.5k stars, MIT license) đã triển khai 100% những gì cần viết
- Viết bằng C++ với OOP, abstraction layers rõ ràng
- Hỗ trợ 60+ board khác nhau qua board config pattern
- Chỉ cần tạo 1 custom board config cho phần cứng cụ thể

---

## Kiến trúc xiaozhi-esp32 (đã phân tích)

### Cấu trúc core modules

```
xiaozhi-esp32/main/
├── application.cc/h         ← Singleton điều phối toàn hệ thống
├── device_state.h           ← 11 DeviceState enum
├── device_state_machine.h   ← FSM chuyển trạng thái
├── mcp_server.cc/h          ← MCP tool server
├── ota.cc/h                 ← OTA firmware update
├── settings.cc/h            ← NVS settings
├── system_info.cc/h         ← System diagnostics
├── assets.cc/h              ← Embedded audio assets
│
├── audio/
│   ├── audio_service.cc/h   ← 3 tasks: Input, Output, OpusCodec
│   ├── audio_codec.cc/h     ← Base class cho hardware codec
│   ├── codecs/              ← ES8311, ES8388, ES8374, MAX98357...
│   ├── processors/          ← AFE audio processor, debugger
│   ├── wake_words/          ← ESP/AFE/Custom wake word
│   └── demuxer/             ← OGG demuxer
│
├── display/
│   ├── display.cc/h         ← Base Display class
│   ├── lcd_display.cc/h     ← SPI/Parallel LCD
│   ├── oled_display.cc/h    ← I2C OLED
│   └── lvgl_display/        ← LVGL port, emoji, gif, jpg, theme, font
│
├── protocols/
│   ├── protocol.cc/h        ← Base Protocol (audio channel, JSON)
│   ├── websocket_protocol.cc/h  ← WebSocket implementation
│   └── mqtt_protocol.cc/h   ← MQTT + UDP implementation
│
├── led/                     ← LED indicators (GPIO, strip, circular)
│
└── boards/
    ├── common/
    │   ├── board.cc/h       ← Base Board class
    │   ├── wifi_board.cc/h  ← WiFi board (STA + config AP)
    │   ├── button.cc/h      ← Button handler (debounce, long press)
    │   ├── backlight.cc/h   ← PWM backlight
    │   └── ...              ← I2C, power, sleep, camera...
    └── <board-name>/        ← 60+ board definitions
        ├── config.h         ← GPIO pinout, features
        └── <board>.cc       ← Board init, codec, display setup
```

### Luồng vận hành chính

```
POWER ON
    │
    ▼
Board::Initialize()
    ├── GPIO, I2C, SPI init
    ├── AudioCodec init (I2S + DAC/ADC)
    ├── Display init (LVGL/OLED)
    └── LED init
    │
    ▼
Application::Initialize()
    ├── AudioService::Initialize(codec)
    ├── Display::SetupUI()
    ├── Set network callbacks
    └── Board::StartNetwork()  ← WiFi STA async connect
    │
    ▼
Application::Run()  ← Main event loop (never returns)
    │
    ├── MAIN_EVENT_NETWORK_CONNECTED
    │   ├── InitializeProtocol() (WebSocket or MQTT)
    │   ├── CheckNewVersion()
    │   └── State → kDeviceStateIdle
    │
    ├── MAIN_EVENT_TOGGLE_CHAT (button press)
    │   ├── If Idle → OpenAudioChannel → Listening
    │   ├── If Listening → StopListening → Idle
    │   └── If Speaking → AbortSpeaking → Listening
    │
    ├── MAIN_EVENT_WAKE_WORD_DETECTED
    │   └── OpenAudioChannel → Listening
    │
    ├── MAIN_EVENT_SEND_AUDIO
    │   └── Pop encoded Opus → Protocol::SendAudio()
    │
    ├── MAIN_EVENT_STATE_CHANGED
    │   └── Update Display, LED, Sound effects
    │
    └── MAIN_EVENT_SCHEDULE
        └── Execute deferred callbacks
```

### DeviceState Machine (11 trạng thái)

```
kDeviceStateStarting
    │
    ├──(WiFi config needed)──→ kDeviceStateWifiConfiguring
    │                              │
    │                              └──(configured)──→ kDeviceStateConnecting
    │
    └──(WiFi OK)──→ kDeviceStateConnecting
                        │
                        ├──(server connected)──→ kDeviceStateIdle
                        │                           │
                        │   ┌───────────────────────┤
                        │   │                       │
                        │   │  ┌──(button/wake)──→ kDeviceStateListening
                        │   │  │                    │
                        │   │  │                    └──(AI responds)──→ kDeviceStateSpeaking
                        │   │  │                                          │
                        │   │  │                                          └──(done)──┐
                        │   │  │                                                     │
                        │   │  └────────────────────────────────────────────────────←─┘
                        │   │
                        │   ├──(OTA available)──→ kDeviceStateUpgrading
                        │   │
                        │   └──(not activated)──→ kDeviceStateActivating
                        │
                        └──(fatal error)──→ kDeviceStateFatalError
```

### Audio Pipeline (chi tiết)

```
          ┌─────────── RECORD PATH ───────────┐
          │                                    │
     [Microphone]                              │
          │                                    │
     [I2S Input]                               │
          │                                    │
     [AFE Processor]  ← Noise reduction, AEC   │
          │                                    │
     [Wake Word]  ← Detection runs in parallel │
          │                                    │
     {Encode Queue}                            │
          │                                    │
     [Opus Encoder]  ← 16kHz mono, 60ms frame  │
          │                                    │
     {Send Queue}                              │
          │                                    │
     [Protocol::SendAudio()]                   │
          │                                    │
          ▼                                    │
     ═══ SERVER ═══                            │
          │                                    │
          ▼                                    │
     [Protocol callback]                       │
          │                                    │
     {Decode Queue}                            │
          │                                    │
     [Opus Decoder]  ← 24kHz, 60ms frame       │
          │                                    │
     [Resampler]  ← Match codec sample rate     │
          │                                    │
     {Playback Queue}                          │
          │                                    │
     [I2S Output]                              │
          │                                    │
     [MAX98357A DAC]                           │
          │                                    │
     [Speaker]                                 │
          └────────── PLAYBACK PATH ───────────┘
```

---

## Kế hoạch triển khai mới: Fork xiaozhi-esp32 + Custom Board

### Phase 0: Setup (ưu tiên cao nhất)

1. Clone xiaozhi-esp32 repo
2. Cài đặt ESP-IDF v5.4.2 (đã có)
3. Build thử với một board có sẵn (vd: `bread-compact-wifi`) để verify toolchain
4. Flash test lên ESP32-S3 N16R8

```bash
git clone https://github.com/78/xiaozhi-esp32.git
cd xiaozhi-esp32
idf.py set-target esp32s3
idf.py menuconfig  # chọn board
idf.py build
idf.py flash monitor
```

### Phase 1: Tạo Custom Board Config

Tạo folder `main/boards/english-teacher-ai/` với 3 files:

**`config.h`** — Định nghĩa GPIO pinout thực tế:

```cpp
#pragma once

// Audio I2S (MAX98357A output only, no mic)
#define AUDIO_I2S_GPIO_BCLK     GPIO_NUM_1
#define AUDIO_I2S_GPIO_LRCK     GPIO_NUM_2
#define AUDIO_I2S_GPIO_DOUT     GPIO_NUM_42

// SPI Display (TFT) — pinout thực tế
#define DISPLAY_SPI_GPIO_MOSI   GPIO_NUM_41
#define DISPLAY_SPI_GPIO_SCK    GPIO_NUM_42
#define DISPLAY_SPI_GPIO_CS     GPIO_NUM_38
#define DISPLAY_SPI_GPIO_DC     GPIO_NUM_39
#define DISPLAY_SPI_GPIO_RST    GPIO_NUM_40
#define DISPLAY_SPI_GPIO_BL     GPIO_NUM_21

// Button
#define BUTTON_GPIO             GPIO_NUM_0

// Display config
#define DISPLAY_WIDTH           240
#define DISPLAY_HEIGHT          320
#define DISPLAY_MIRROR_X        false
#define DISPLAY_MIRROR_Y        false
#define DISPLAY_SWAP_XY         false

// Features
#define BOARD_HAS_DISPLAY       1
#define BOARD_HAS_LED           0
```

**`english_teacher_ai.cc`** — Board initialization:

```cpp
#include "wifi_board.h"
#include "audio_codec.h"
#include "display/lcd_display.h"
#include "config.h"

class EnglishTeacherAiBoard : public WifiBoard {
private:
    LcdDisplay* display_ = nullptr;
    AudioCodec* audio_codec_ = nullptr;

public:
    void Initialize() override {
        // Audio: MAX98357A (output-only I2S codec)
        audio_codec_ = new NoAudioCodec(
            AUDIO_I2S_GPIO_BCLK,
            AUDIO_I2S_GPIO_LRCK,
            AUDIO_I2S_GPIO_DOUT
        );

        // Display: SPI TFT (ST7789 or ILI9341)
        display_ = new LcdDisplay(
            DISPLAY_SPI_GPIO_MOSI,
            DISPLAY_SPI_GPIO_SCK,
            DISPLAY_SPI_GPIO_CS,
            DISPLAY_SPI_GPIO_DC,
            DISPLAY_SPI_GPIO_RST,
            DISPLAY_SPI_GPIO_BL,
            DISPLAY_WIDTH, DISPLAY_HEIGHT,
            DISPLAY_MIRROR_X, DISPLAY_MIRROR_Y,
            DISPLAY_SWAP_XY
        );

        // Button
        SetupButton(BUTTON_GPIO);

        WifiBoard::Initialize();
    }

    AudioCodec* GetAudioCodec() override {
        return audio_codec_;
    }

    Display* GetDisplay() override {
        return display_;
    }
};

// Board factory registration
DECLARE_BOARD(EnglishTeacherAiBoard);
```

**`config.json`** — Board metadata:

```json
{
    "target": "esp32s3",
    "board_name": "EnglishTeacherAI",
    "description": "ESP32-S3 N16R8 AI English Teacher",
    "sdkconfig_append": [
        "CONFIG_ESPTOOLPY_FLASHSIZE_16MB=y",
        "CONFIG_SPIRAM=y",
        "CONFIG_SPIRAM_MODE_OCT=y",
        "CONFIG_SPIRAM_SPEED_80M=y"
    ]
}
```

### Phase 2: Customize cho English Teacher

Sau khi board chạy được với xiaozhi-esp32 cơ bản:

| # | Task | Mô tả |
|:--|:-----|:------|
| 1 | **Server setup** | Deploy xiaozhi-esp32-server (Python backend) hoặc kết nối server public |
| 2 | **English Teacher prompt** | Cấu hình LLM system prompt cho việc dạy tiếng Anh |
| 3 | **Custom UI screens** | Thêm LVGL screens hiển thị vocabulary, grammar tips, pronunciation guide |
| 4 | **Lesson mode** | Thêm MCP tool cho lesson plan: flashcard, quiz, conversation practice |
| 5 | **Progress tracking** | Lưu tiến độ học vào NVS hoặc FAT partition |
| 6 | **Multi-language TTS** | Config server TTS cho English + Vietnamese explanation |

### Phase 3: Tối ưu & Polish

| # | Task |
|:--|:-----|
| 1 | Custom emoji/animation cho English Teacher personality |
| 2 | Thêm microphone (INMP441) nếu muốn voice input |
| 3 | Battery management (nếu portable) |
| 4 | OTA channel riêng cho firmware updates |
| 5 | Thêm LED indicator cho trạng thái |

---

## Những gì cần giữ lại từ project hiện tại

| File | Giữ/Bỏ | Lý do |
|:-----|:--------|:------|
| `scripts/*.sql, *.js, *.py` | **Giữ** | Tooling cho server/backend, không liên quan firmware |
| `components/*` | **Bỏ** | Thay bằng xiaozhi-esp32 modules |
| `main/main.c` | **Bỏ** | Thay bằng xiaozhi application.cc |
| `partitions.csv` | **Bỏ** | Dùng xiaozhi partition layout (có OTA) |
| `sdkconfig.defaults` | **Merge** | Giữ config N16R8, merge vào board config.json |
| `.github/prompts/plan-*.md` | **Giữ** | Reference kiến trúc ban đầu |

---

## Lưu ý quan trọng

### Pinout thực tế (ĐÃ CẬP NHẬT)

| Peripheral | Pin | Ghi chú |
|:-----------|:----|:--------|
| I2S BCLK | GPIO 1 | MAX98357A |
| I2S LRCK | GPIO 2 | MAX98357A |
| I2S DOUT | GPIO 42 | MAX98357A |
| SPI MOSI | **GPIO 41** | Display (đã sửa từ GPIO 11) |
| SPI SCK | **GPIO 42** | Display (đã sửa từ GPIO 12) |
| SPI CS | **GPIO 38** | Display (đã sửa từ GPIO 10) |
| SPI DC | GPIO 39 | Display |
| SPI RST | GPIO 40 | Display |
| BL | GPIO 21 | Backlight PWM |
| Button | GPIO 0 | Boot button |

**Chú ý:** GPIO 42 dùng chung cho I2S DOUT và SPI SCK — cần verify xung đột!

### xiaozhi-esp32 vs code tự viết

| Tiêu chí | Tự viết (C) | xiaozhi-esp32 (C++) |
|:---------|:------------|:-------------------|
| Thời gian hoàn thành | 2-4 tháng | 1-2 tuần (custom board) |
| Audio quality | Phải tự tune | Opus, resampling, AEC đã tune sẵn |
| Stability | Phải tự test | 24.5k stars, cộng đồng test |
| OTA | Phải tự viết | Có sẵn |
| MCP / IoT | Phải tự viết | Có sẵn |
| Maintenance | Tự maintain | Community maintain |
| Learning value | Cao | Trung bình (dùng framework) |

### Repo tham khảo

- Firmware: https://github.com/78/xiaozhi-esp32
- Server: https://github.com/xinnan-tech/xiaozhi-esp32-server
- Docs: https://xiaozhi.dev/en/docs/
- Custom board guide: https://github.com/78/xiaozhi-esp32/blob/main/docs/custom-board.md
