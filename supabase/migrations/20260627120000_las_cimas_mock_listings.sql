-- Seed Las Cimas demo listings under the legacy mock seller profiles.
-- Idempotent: safe to re-run; skips rows that already exist.

insert into profiles (id, email, name, bio, social_url, profile_photo_url, role, created_at)
values
  ('seller-mock-1', 'seller@example.com', 'John''s Garden', 'Fresh organic vegetables from our Las Cimas garden.', '', '', 'general', '2026-04-24T06:00:00Z'),
  ('seller-mock-2', 'alice@example.com', 'Alice''s Farmers Market', 'Seasonal produce, always fresh from the neighborhood.', '', '', 'general', '2026-04-24T06:05:00Z'),
  ('seller-mock-3', 'bob@example.com', 'Bob''s Community Farm', 'Supporting local agriculture in Las Cimas.', '', '', 'general', '2026-04-24T06:10:00Z')
on conflict (id) do update set
  email = excluded.email,
  name = excluded.name,
  bio = excluded.bio;

insert into community_members (community_id, user_id, joined_at)
values
  ('737f5af2-89ac-4392-bfdf-5a666d516311', 'seller-mock-1', '2026-04-24T06:15:00Z'),
  ('737f5af2-89ac-4392-bfdf-5a666d516311', 'seller-mock-2', '2026-04-24T06:16:00Z'),
  ('737f5af2-89ac-4392-bfdf-5a666d516311', 'seller-mock-3', '2026-04-24T06:17:00Z')
on conflict (community_id, user_id) do nothing;

insert into listings (
  id, seller_id, title, description, quantity, photos, looking_for,
  community_id, zip_code, status, created_at, expires_at
)
values
  -- John's Garden
  (
    'b1000001-0000-4000-8000-000000000001', 'seller-mock-1',
    'Heirloom Tomatoes', 'Sweet, low-acid tomatoes picked this morning from our backyard vines.',
    '6 lbs', array['https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=800'],
    'Fresh eggs', '737f5af2-89ac-4392-bfdf-5a666d516311', '78724', 'active',
    '2026-06-26T10:00:00Z', '2026-07-10T10:00:00Z'
  ),
  (
    'b1000001-0000-4000-8000-000000000002', 'seller-mock-1',
    'Jalapeño Peppers', 'Medium heat, great for salsa and pickling.',
    '2 lbs', array['https://images.unsplash.com/photo-1583454110551-21f2fa2afe61?w=800'],
    'Cilantro', '737f5af2-89ac-4392-bfdf-5a666d516311', '78724', 'active',
    '2026-06-25T14:00:00Z', '2026-07-09T14:00:00Z'
  ),
  (
    'b1000001-0000-4000-8000-000000000003', 'seller-mock-1',
    'Okra', 'Tender pods, perfect for gumbo or roasting.',
    '3 lbs', array['https://images.unsplash.com/photo-1607301405206-8f0f2ed006d2?w=800'],
  null, '737f5af2-89ac-4392-bfdf-5a666d516311', '78724', 'active',
    '2026-06-24T09:00:00Z', '2026-07-08T09:00:00Z'
  ),
  (
    'b1000001-0000-4000-8000-000000000004', 'seller-mock-1',
    'Bell Peppers', 'Mixed red, yellow, and green — crisp and sweet.',
    '8 ct', array['https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=800'],
    'Onions', '737f5af2-89ac-4392-bfdf-5a666d516311', '78724', 'active',
    '2026-06-23T11:00:00Z', '2026-07-07T11:00:00Z'
  ),
  -- Alice's Farmers Market
  (
    'b1000002-0000-4000-8000-000000000001', 'seller-mock-2',
    'Pasture-Raised Eggs', 'A dozen mixed brown and blue eggs from happy hens.',
    '1 dozen', array['https://images.unsplash.com/photo-1582722872405-44c2f0049493?w=800'],
    'Sourdough', '737f5af2-89ac-4392-bfdf-5a666d516311', '78724', 'active',
    '2026-06-26T08:00:00Z', '2026-07-10T08:00:00Z'
  ),
  (
    'b1000002-0000-4000-8000-000000000002', 'seller-mock-2',
    'Blackberries', 'Wild-picked along the greenbelt — sweet and juicy.',
    '3 pints', array['https://images.unsplash.com/photo-1498557850523-fd3d118b963e?w=800'],
    'Peaches', '737f5af2-89ac-4392-bfdf-5a666d516311', '78724', 'active',
    '2026-06-25T16:00:00Z', '2026-07-09T16:00:00Z'
  ),
  (
    'b1000002-0000-4000-8000-000000000003', 'seller-mock-2',
    'Herb Bundle', 'Rosemary, thyme, and oregano bundled fresh.',
    '3 bunches', array['https://images.unsplash.com/photo-1618375569909-3c8616cf7733?w=800'],
    'Tomatoes', '737f5af2-89ac-4392-bfdf-5a666d516311', '78724', 'active',
    '2026-06-24T13:00:00Z', '2026-07-08T13:00:00Z'
  ),
  (
    'b1000002-0000-4000-8000-000000000004', 'seller-mock-2',
    'Figs', 'Brown Turkey figs, tree-ripened and delicate.',
    '2 lbs', array['https://images.unsplash.com/photo-1615485290382-441e4d049cb5?w=800'],
  null, '737f5af2-89ac-4392-bfdf-5a666d516311', '78724', 'active',
    '2026-06-22T10:00:00Z', '2026-07-06T10:00:00Z'
  ),
  -- Bob's Community Farm
  (
    'b1000003-0000-4000-8000-000000000001', 'seller-mock-3',
    'Sweet Potatoes', 'Orange-fleshed, cured and ready to roast.',
    '10 lbs', array['https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=800'],
    'Collard greens', '737f5af2-89ac-4392-bfdf-5a666d516311', '78724', 'active',
    '2026-06-26T12:00:00Z', '2026-07-10T12:00:00Z'
  ),
  (
    'b1000003-0000-4000-8000-000000000002', 'seller-mock-3',
    'Watermelon', 'Seedless Charleston Gray — cold and sweet.',
    '2 melons', array['https://images.unsplash.com/photo-1587049352846-4a222e784422?w=800'],
    'Cantaloupe', '737f5af2-89ac-4392-bfdf-5a666d516311', '78724', 'active',
    '2026-06-25T09:00:00Z', '2026-07-09T09:00:00Z'
  ),
  (
    'b1000003-0000-4000-8000-000000000003', 'seller-mock-3',
    'Cucumbers', 'Crisp slicing cucumbers from the trellis.',
    '5 lbs', array['https://images.unsplash.com/photo-1604977042946-1aacbb56dd2f?w=800'],
    'Dill', '737f5af2-89ac-4392-bfdf-5a666d516311', '78724', 'active',
    '2026-06-24T15:00:00Z', '2026-07-08T15:00:00Z'
  ),
  (
    'b1000003-0000-4000-8000-000000000004', 'seller-mock-3',
    'Raw Wildflower Honey', 'Unfiltered honey from hives two blocks over.',
    '3 jars', array['https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=800'],
    'Lemons', '737f5af2-89ac-4392-bfdf-5a666d516311', '78724', 'active',
    '2026-06-23T08:00:00Z', '2026-07-07T08:00:00Z'
  )
on conflict (id) do nothing;
