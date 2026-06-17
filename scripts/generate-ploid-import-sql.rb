#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "fileutils"

USER_ID = "79fc0605-1641-4d5f-97f2-f16fadfad0fa"
TEAM_ID = "1396953c-63b8-4e03-b33b-147639ca0c1b"
BATCH_SIZE = 80

def sql_str(value)
  "'#{value.to_s.gsub("'", "''").gsub("\n", " | ")}'"
end

json_path = ARGV[0] || File.expand_path("../data/ploid-people.json", __dir__)
out_dir = ARGV[1] || File.expand_path("../data/import-batches", __dir__)
contacts = JSON.parse(File.read(json_path, encoding: "UTF-8"))

FileUtils.mkdir_p(out_dir)
FileUtils.rm(Dir.glob(File.join(out_dir, "*.sql")))

companies = contacts.map { |c| c["company"] }.reject(&:empty?).uniq.sort

companies.each_slice(BATCH_SIZE).with_index do |slice, i|
  values = slice.map { |name| "(#{sql_str(TEAM_ID)}, #{sql_str(name)})" }.join(",\n  ")
  sql = <<~SQL
    INSERT INTO companies (team_id, name)
    SELECT v.team_id::uuid, v.name
    FROM (VALUES
      #{values}
    ) AS v(team_id, name)
    WHERE NOT EXISTS (
      SELECT 1 FROM companies c
      WHERE c.team_id = v.team_id::uuid AND c.name = v.name
    );
  SQL
  File.write(File.join(out_dir, format("companies-%03d.sql", i + 1)), sql)
end

contacts.each_slice(BATCH_SIZE).with_index do |slice, i|
  rows = slice.map do |c|
    name = sql_str(c["name"])
    email = sql_str(c["email"])
    company = sql_str(c["company"])
    notes = sql_str(c["notes"])
    "(#{sql_str(USER_ID)}, #{sql_str(TEAM_ID)}, #{name}, #{email}, #{company}, #{notes})"
  end.join(",\n  ")

  sql = <<~SQL
    INSERT INTO contacts (user_id, team_id, name, email, company, notes, company_id)
    SELECT v.user_id::uuid, v.team_id::uuid, v.name, v.email, v.company, v.notes, c.id
    FROM (VALUES
      #{rows}
    ) AS v(user_id, team_id, name, email, company, notes)
    LEFT JOIN companies c ON c.team_id = v.team_id::uuid AND c.name = v.company
    WHERE NOT EXISTS (
      SELECT 1 FROM contacts existing
      WHERE existing.team_id = v.team_id::uuid
        AND existing.user_id = v.user_id::uuid
        AND existing.name = v.name
        AND existing.company = v.company
    );
  SQL
  File.write(File.join(out_dir, format("contacts-%03d.sql", i + 1)), sql)
end

puts "Generated #{Dir.glob(File.join(out_dir, 'companies-*.sql')).size} company batches"
puts "Generated #{Dir.glob(File.join(out_dir, 'contacts-*.sql')).size} contact batches"
puts "Companies to import: #{companies.size}"
puts "Contacts to import: #{contacts.size}"
