INSERT INTO contacts (user_id, team_id, name, email, company, notes, company_id)
SELECT v.user_id::uuid, v.team_id::uuid, v.name, v.email, v.company, v.notes, c.id
FROM (VALUES
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Lina C.', '', 'Braze', 'Title: GTM Productivity Strategy | Tags: Owner: Mayur'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Lincoln Silver', '', 'Niantic Spatial, Inc.', 'Title: GTM / Strategy | Tags: Owner: sjm9829 Reached Out Connected: Pending Messaged'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Lindsay Millar', '', 'Dataminr', 'Title: VP, GTM Enablement | Tags: Owner: Adelaide'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Linh Van', '', 'Freepik', 'Title: Enterprise Growth Marketing Manager – AI Creative | Freepik | Tags: Owner: Adelaide'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Lisa Finfer', '', 'Savannah, Georgia, United States, North America', 'Title: Fractional Customer Success & GTM Consultant | Tags: Owner: Mayur'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Lisa Horner', '', 'Scale Venture Partners', 'Title: GTM Advisor | Tags: Owner: Charo'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Lizzie Mahaney', '', 'Lattice', 'Title: GTM Recruiter | Tags: Owner: Charo'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Loc Nguyen', '', 'Cisco', 'Title: System Engineer - Software GTM Technical Lead | Tags: Owner: Mayur'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Logan', '', '', 'Tags: Customer'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Logan Lemery', '', 'IgniteGTM', 'Title: GTM Advisor, Head Of Content | Tags: Owner: sjm9829'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Loren Schieni', '', 'Madhive', 'Title: Senior Manager of Growth Marketing, Product GTM | Tags: Owner: Adelaide'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Lotus Lu', '', 'Amazon', 'Title: Sr. Product Marketing Manager, Amazon Devices - Tablet GTM & IMC | Tags: Owner: Adelaide'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Lucas El Ayadi', '', '1Sphere AI', 'Title: GTM | Tags: Owner: Mayur'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Lucas Gacek', '', 'SEON', 'Title: Sr. Director, GTM Operations | Tags: Owner: sjm9829'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Lucas Grant', '', 'Propel Prospect', 'Title: Senior Executive | Tags: Owner: Charo Reached Out'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Lucas Paiva', '', 'DNA Conteúdo Digital', 'Title: GTM Engineer & Revenue Strategist | Tags: Owner: Mayur'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Lucas Presentacion', '', 'Spark', 'Title: GTM Lead | Tags: Owner: Charo'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Lucas Roson Martin', '', 'Oracle', 'Title: Sales VP Telco GTM & Strategy LAD | Tags: Owner: sjm9829 Reached Out Messaged'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Lucy Jenks', '', 'SEPHORA', 'Title: Director, Marketing Strategy | Tags: Owner: sjm9829 Reached Out Connected: Pending Messaged'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Luka Secilmis', '', 'Browser Use', 'Title: Product & GTM Lead | Tags: Owner: Adelaide'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Luke Alie', '', 'Atolio', 'Title: GTM Engineer | Tags: Owner: sjm9829 Reached Out Messaged'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Luke Judson', '', 'Taylor Stitch', 'Title: Director | GTM | Tags: Owner: Charo Reached Out Followed Up Ghosted'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Lynn Comp', '', 'Napatech', 'Title: Member Board of Directors | Tags: Owner: Adelaide'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Lynn Powers', '', 'Actively AI', 'Title: Strategic Enterprise GTM | Tags: Owner: Mayur'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Lynne DeRoché', '', 'Vision x Velocity', 'Title: Founder | Certified GTM Advisor & Fractional CMO | Tags: Owner: sjm9829'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Mackenzie Branigan', '', 'Salesforce', 'Title: VP, Product GTM | Tags: Owner: Charo'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Madison Alperin', '', 'Gartner', 'Title: Sr. Director - GTM Strategy, Sales Territory Investment and Design | Tags: Owner: Mayur'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Maggie Hott', '', '20SALES', 'Title: Founding Partner | Tags: Owner: sjm9829 Reached Out Connected: Pending Messaged'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Mahek M.', '', 'Sieve', 'Title: Product/Ops & GTM Lead | Tags: Owner: Mayur'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'MAHESH KAUSHIK', '', 'ConversAILabs', 'Title: Co-Founder | Tags: Owner: sjm9829'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Maísa D.', '', 'Box', 'Title: GTM - Enterprise Sales | LATAM | Tags: Owner: sjm9829 Reached Out Messaged'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Maitri Choksey', '', 'Sana', 'Title: Founding GTM - US | Tags: Owner: sjm9829'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Majd Omar', '', 'Paycom', 'Title: Junior Sales executive intern | Tags: Owner: sjm9829'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Mallika Reddy', '', 'Tremendous', 'Title: GTM Strategy & Ops | Tags: Owner: Mayur'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Mallorey Mulvihill, MBA', '', 'Stripe', 'Title: AI GTM, Strategic Accounts | Tags: Owner: Mayur'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Maninder Sawhney', '', 'Adobe', 'Title: SVP GTM & Sales; Creativity & Productivity Business | Tags: Owner: Adelaide'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Manisha Bavabhai Aguilar', '', 'LEAD3R', 'Title: Fractional Senior GTM/Tech Recruiter | Tags: Owner: sjm9829'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Manisha Verma', '', 'HPE Aruba Networking', 'Title: Heading Software Portfolio GTM Strategy and Growth Programs | Tags: Owner: Mayur'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Manny Hernandez', 'eh3419@nyu.edu', 'Ploid', 'Title: Founder | Tags: Founder'),
  ('79fc0605-1641-4d5f-97f2-f16fadfad0fa', '1396953c-63b8-4e03-b33b-147639ca0c1b', 'Mansi Arora, MBA', '', 'Celonis', 'Title: GTM Strategy - Senior Value Engineer | Tags: Owner: Charo')
) AS v(user_id, team_id, name, email, company, notes)
LEFT JOIN companies c ON c.team_id = v.team_id::uuid AND c.name = v.company
WHERE NOT EXISTS (
  SELECT 1 FROM contacts existing
  WHERE existing.team_id = v.team_id::uuid
    AND existing.user_id = v.user_id::uuid
    AND existing.name = v.name
    AND existing.company = v.company
);
