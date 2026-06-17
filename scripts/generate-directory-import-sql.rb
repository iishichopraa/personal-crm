#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "fileutils"

TEAM_ID = "1396953c-63b8-4e03-b33b-147639ca0c1b"
BATCH_SIZE = 80

def sql_str(value)
  "'#{value.to_s.gsub("'", "''").gsub("\n", " | ")}'"
end

json_path = ARGV[0] || File.expand_path("../data/ploid-people.json", __dir__)
out_dir = ARGV[1] || File.expand_path("../data/import-directory-batches", __dir__)
people = JSON.parse(File.read(json_path, encoding: "UTF-8"))

FileUtils.mkdir_p(out_dir)
FileUtils.rm(Dir.glob(File.join(out_dir, "directory-*.sql")))

people.each_slice(BATCH_SIZE).with_index do |slice, i|
  rows = slice.map do |p|
    notes = p["notes"].to_s
    "(#{sql_str(TEAM_ID)}, #{sql_str(p['name'])}, #{sql_str(p['email'])}, '', #{sql_str(p['company'])}, #{sql_str(notes)})"
  end.join(",\n  ")

  sql = <<~SQL
    INSERT INTO directory_people (team_id, name, email, phone, company, notes)
    SELECT v.team_id::uuid, v.name, v.email, v.phone, v.company, v.notes
    FROM (VALUES
      #{rows}
    ) AS v(team_id, name, email, phone, company, notes)
    WHERE NOT EXISTS (
      SELECT 1 FROM directory_people d
      WHERE d.team_id = v.team_id::uuid AND d.name = v.name AND d.company = v.company
    );
  SQL
  File.write(File.join(out_dir, format("directory-%03d.sql", i + 1)), sql)
end

puts "Generated #{Dir.glob(File.join(out_dir, 'directory-*.sql')).size} batches for #{people.size} people"
