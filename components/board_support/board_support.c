#include <stdio.h>
#include "board_support.h"

#include "esp_heap_caps.h"
#include "esp_system.h"
#include "esp_log.h"
#include "driver/gpio.h"

static const char *TAG = "board_support";

void board_support_init(void)
{
    ESP_LOGI(TAG, "Board Support Initialized");

#ifdef CONFIG_SPIRAM
    size_t spiram_size = heap_caps_get_total_size(MALLOC_CAP_SPIRAM);
    if (spiram_size > 0) {
        ESP_LOGI(TAG, "PSRAM available, total size: %u bytes", (unsigned)spiram_size);
    } else {
        ESP_LOGW(TAG, "PSRAM not detected or init failed");
    }
#endif

    gpio_config_t io_conf = {
        .intr_type = GPIO_INTR_NEGEDGE,
        .mode = GPIO_MODE_INPUT,
        .pin_bit_mask = (1ULL << GPIO_NUM_0),
        .pull_up_en = GPIO_PULLUP_ENABLE,
    };
    gpio_config(&io_conf);
}