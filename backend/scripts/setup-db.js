import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

const PG_CONFIG = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
};

async function setup() {
    console.log('Connecting to default postgres database...');
    const adminClient = new Client({ ...PG_CONFIG, database: 'postgres' });
    await adminClient.connect();

    // Check if database arcgpt_institution exists
    const res = await adminClient.query(
        "SELECT 1 FROM pg_database WHERE datname = 'arcgpt_institution'"
    );
    if (res.rows.length === 0) {
        console.log('Creating database arcgpt_institution...');
        await adminClient.query('CREATE DATABASE arcgpt_institution');
    } else {
        console.log('Database arcgpt_institution already exists.');
    }
    await adminClient.end();

    // Connect to arcgpt_institution
    console.log('Connecting to arcgpt_institution database...');
    const dbClient = new Client({ ...PG_CONFIG, database: 'arcgpt_institution' });
    await dbClient.connect();

    console.log('Running institution.sql schema...');
    const institutionSql = fs.readFileSync(path.resolve('src/migration/sql/institution.sql'), 'utf-8');
    await dbClient.query(institutionSql);

    console.log('Running file1.sql (ArcGPT core schema & roles)...');
    const file1Sql = fs.readFileSync(path.resolve('src/migration/sql/file1.sql'), 'utf-8');
    await dbClient.query(file1Sql);

    console.log('Running seed_institution.sql...');
    const seedSql = fs.readFileSync(path.resolve('src/migration/sql/seed_institution.sql'), 'utf-8');
    await dbClient.query(seedSql);

    // Bootstrap local admin user in arcgpt_users
    console.log('Bootstrapping local admin user...');
    const adminEmail = process.env.LOCAL_ADMIN_EMAIL || 'admin@institution.edu';
    const adminPassword = process.env.LOCAL_ADMIN_PASSWORD || 'AdminPassword123!';
    const passwordHash = await bcrypt.hash(adminPassword, 10);

    await dbClient.query(`
        INSERT INTO public.arcgpt_users (full_name, email, password_hash, role, status)
        VALUES ('System Administrator', $1, $2, 'ADMIN', 'ACTIVE')
        ON CONFLICT (email) DO UPDATE SET password_hash = $2, role = 'ADMIN', status = 'ACTIVE'
    `, [adminEmail, passwordHash]);

    // Bootstrap a student user as well
    const studentPasswordHash = await bcrypt.hash('Student123!', 10);
    await dbClient.query(`
        INSERT INTO public.arcgpt_users (full_name, email, password_hash, role, status)
        VALUES ('Student User', 'student@student.institution.edu', $1, 'STUDENT', 'ACTIVE')
        ON CONFLICT (email) DO UPDATE SET password_hash = $1, role = 'STUDENT', status = 'ACTIVE'
    `, [studentPasswordHash]);

    // Create arcgpt_reader login user if not exists and grant read-only permissions
    console.log('Configuring arcgpt_reader role...');
    try {
        await dbClient.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arcgpt_reader') THEN
                    CREATE ROLE arcgpt_reader LOGIN PASSWORD 'reader_password';
                ELSE
                    ALTER ROLE arcgpt_reader WITH LOGIN PASSWORD 'reader_password';
                END IF;
                GRANT USAGE ON SCHEMA public TO arcgpt_reader;
                GRANT SELECT ON ALL TABLES IN SCHEMA public TO arcgpt_reader;
                GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO arcgpt_reader;
                ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO arcgpt_reader;
            END
            $$;
        `);
    } catch (e) {
        console.warn('Note on reader role setup:', e.message);
    }

    // Verification queries (Requirements 7, 9)
    console.log('\n================ VERIFICATION ================');
    const studentCount = await dbClient.query('SELECT COUNT(*) AS total_students FROM public.students');
    console.log('Total students:', studentCount.rows[0].total_students);

    const deptCount = await dbClient.query('SELECT COUNT(*) AS total_departments FROM public.departments');
    console.log('Total departments:', deptCount.rows[0].total_departments);

    const depts = await dbClient.query('SELECT department_code, department_name FROM public.departments ORDER BY department_code');
    console.log('Departments:', depts.rows);

    const sampleStudents = await dbClient.query('SELECT student_id, register_number, first_name, last_name FROM public.students LIMIT 5');
    console.log('Sample students:', sampleStudents.rows);

    const attendanceSample = await dbClient.query('SELECT * FROM public.student_attendance_percentage WHERE department_code = \'AIML\' AND attendance_percentage < 75 LIMIT 5');
    console.log('AIML students with < 75% attendance:', attendanceSample.rows.length);

    console.log('==============================================\n');

    await dbClient.end();
    console.log('Database setup and verification complete!');
}

setup().catch(err => {
    console.error('Database setup failed:', err);
    process.exit(1);
});
