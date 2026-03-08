-- Music tables for parent dashboard
-- Run: docker exec -i xiaozhi-esp32-server-db mysql -uroot -p123456 xiaozhi_esp32_server < migrations/001-music-tables.sql

CREATE TABLE IF NOT EXISTS parent_music (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  title VARCHAR(200) NOT NULL,
  artist VARCHAR(100) DEFAULT '',
  category VARCHAR(50) DEFAULT 'general',
  filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) DEFAULT '',
  file_size INT DEFAULT 0,
  duration_sec INT DEFAULT 0,
  sort_order INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  INDEX idx_category (category)
);

CREATE TABLE IF NOT EXISTS parent_playlist (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id)
);

CREATE TABLE IF NOT EXISTS parent_playlist_item (
  id INT AUTO_INCREMENT PRIMARY KEY,
  playlist_id INT NOT NULL,
  music_id INT NOT NULL,
  sort_order INT DEFAULT 0,
  FOREIGN KEY (playlist_id) REFERENCES parent_playlist(id) ON DELETE CASCADE,
  FOREIGN KEY (music_id) REFERENCES parent_music(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS parent_play_schedule (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  mac_address VARCHAR(32) NOT NULL,
  playlist_id INT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  days_of_week VARCHAR(20) DEFAULT '1,2,3,4,5,6,7',
  is_active TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (playlist_id) REFERENCES parent_playlist(id) ON DELETE CASCADE,
  INDEX idx_user (user_id),
  INDEX idx_active (is_active, mac_address)
);
