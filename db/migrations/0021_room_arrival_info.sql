-- Ankunftsinfos (Schlüsselcode, WLAN …) pro Zimmertyp/Wohnung; überschreiben die allgemeinen Infos des Hotels (hotels.content.arrivalInfo).
ALTER TABLE room_types ADD COLUMN arrival_info text CHECK (arrival_info IS NULL OR char_length(arrival_info) <= 2000);
