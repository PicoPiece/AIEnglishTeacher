-- SD Card music support: device reports files on SD card, server stores metadata
-- Run: docker exec -i xiaozhi-esp32-server-db mysql -uroot -p123456 xiaozhi_esp32_server < migrations/012-sd-card-music.sql

CREATE TABLE IF NOT EXISTS device_sd_files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mac_address VARCHAR(32) NOT NULL,
  filepath VARCHAR(500) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  file_size INT DEFAULT 0,
  category VARCHAR(50) DEFAULT 'general',
  last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mac_path (mac_address, filepath),
  INDEX idx_mac (mac_address)
);

-- Allow playlist items to reference SD files instead of (or in addition to) server music
ALTER TABLE parent_playlist_item
  ADD COLUMN sd_file_id INT NULL AFTER music_id,
  MODIFY COLUMN music_id INT NULL;
