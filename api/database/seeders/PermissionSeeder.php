<?php

namespace Database\Seeders;

use App\Models\Permission;
use App\Models\Role;
use Illuminate\Database\Seeder;

/**
 * P1 permission matrix (approved, minimal — no extra permissions).
 * The admin role intentionally has NO rows here: hasPermission() grants
 * admin a full bypass ("*"), so permissions for admin are never enumerated.
 */
class PermissionSeeder extends Seeder
{
    /** @var array<string, array<int, string>> role => permission names */
    private const MATRIX = [
        'support' => [
            'users.view',
            'support.view',
            'support.reply',
            'chat.internal',
        ],
        'expert' => [
            'users.view',
            'support.view',
            'support.reply',
            'chat.internal',
        ],
        'business_owner' => [],
        'designer' => [],
        'user' => [],
    ];

    private const PERMISSIONS = [
        'users.view' => 'مشاهده کاربران',
        'support.view' => 'مشاهده گفتگوهای پشتیبانی',
        'support.reply' => 'پاسخ به گفتگوهای پشتیبانی',
        'chat.internal' => 'گفتگوی داخلی همکاران',
    ];

    public function run(): void
    {
        foreach (self::PERMISSIONS as $name => $display) {
            Permission::updateOrCreate(
                ['name' => $name],
                ['display_name' => $display],
            );
        }

        foreach (self::MATRIX as $roleName => $permissionNames) {
            $role = Role::where('name', $roleName)->first();
            if (! $role) {
                continue;
            }

            $ids = Permission::whereIn('name', $permissionNames)->pluck('id');
            $role->permissions()->sync($ids);
        }
    }
}
