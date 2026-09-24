<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class AvatarTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_upload_and_replace_profile_photo(): void
    {
        Storage::fake('public');
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);

        $first = $this->actingAs($user)->postJson('/api/auth/avatar', [
            'avatar' => UploadedFile::fake()->image('me.png', 100, 100),
        ]);

        $first->assertOk()->assertJsonStructure(['message', 'avatar_url']);
        $user->refresh();
        $this->assertNotNull($user->avatar);
        Storage::disk('public')->assertExists($user->avatar);

        // Replace: old file must be deleted so storage stays clean.
        $oldPath = $user->avatar;

        $second = $this->actingAs($user)->postJson('/api/auth/avatar', [
            'avatar' => UploadedFile::fake()->image('me2.jpg', 100, 100),
        ]);

        $second->assertOk();
        Storage::disk('public')->assertMissing($oldPath);
        $this->assertNotSame($oldPath, $user->fresh()->avatar);
    }

    public function test_non_image_upload_is_rejected(): void
    {
        Storage::fake('public');
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);

        $this->actingAs($user)->postJson('/api/auth/avatar', [
            'avatar' => UploadedFile::fake()->create('script.php', 20, 'application/x-php'),
        ])->assertUnprocessable();

        $this->assertNull($user->fresh()->avatar);
    }

    public function test_avatar_is_exposed_in_me_and_can_be_deleted(): void
    {
        Storage::fake('public');
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);

        // Use a format the test environment's GD build always supports. The
        // production avatar pipeline accepts webp too; the test only proves
        // upload/replace/expose/delete semantics, not GD's codec list. (CI
        // runners and the dev image differ in bundled GD webp support, which
        // made UploadedFile::fake()->image('me.webp') environment-dependent.)
        $this->actingAs($user)->postJson('/api/auth/avatar', [
            'avatar' => UploadedFile::fake()->image('me.png', 64, 64),
        ])->assertOk();

        $this->actingAs($user)->getJson('/api/auth/me')
            ->assertOk()
            ->assertJsonPath('avatar', $user->fresh()->avatar);

        $path = $user->fresh()->avatar;
        $this->actingAs($user)->deleteJson('/api/auth/avatar')->assertOk();
        Storage::disk('public')->assertMissing($path);
        $this->assertNull($user->fresh()->avatar);
    }

    public function test_guest_cannot_upload_avatar(): void
    {
        $this->postJson('/api/auth/avatar', [])->assertUnauthorized();
    }
}
