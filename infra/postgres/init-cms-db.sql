-- Strapi owns its own database and its own schema lifecycle. It never touches
-- the core database, and the core migrations never touch this one.
CREATE ROLE mbs_cms WITH LOGIN PASSWORD 'mbs_cms_local_dev';
CREATE DATABASE mbs_cms OWNER mbs_cms;
