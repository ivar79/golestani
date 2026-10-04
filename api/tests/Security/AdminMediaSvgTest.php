<?php

namespace Tests\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Admin media library upload guard: SVG is the one static format that can
 * execute script when opened directly, so executable SVG payloads are rejected
 * at upload (the nginx layer sandboxes SVG responses as defense in depth).
 */
class AdminMediaSvgTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->unique()->numerify('#########'), 'is_active' => true]);
        $user->assignRole('admin');

        return $user;
    }

    public function test_executable_svg_payloads_are_rejected(): void
    {
        Storage::fake('public');
        $this->actingAs($this->admin());

        $payloads = [
            'script.svg' => '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
            'handler.svg' => '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
            'foreign.svg' => '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject></svg>',
            'entity.svg' => '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&xxe;</text></svg>',
        ];

        foreach ($payloads as $name => $contents) {
            $this->withHeader('X-Requested-With', 'XMLHttpRequest')
                ->post('/api/admin/media', ['file' => UploadedFile::fake()->createWithContent($name, $contents)], ['Content-Type' => 'multipart/form-data'])
                ->assertStatus(422);
        }

        $this->assertSame([], Storage::disk('public')->allFiles());
    }

    public function test_plain_svg_and_raster_uploads_still_work(): void
    {
        Storage::fake('public');
        $this->actingAs($this->admin());

        $svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="#0ea5e9"/></svg>';
        $this->withHeader('X-Requested-With', 'XMLHttpRequest')
            ->post('/api/admin/media', ['file' => UploadedFile::fake()->createWithContent('logo.svg', $svg)], ['Content-Type' => 'multipart/form-data'])
            ->assertCreated();

        $this->withHeader('X-Requested-With', 'XMLHttpRequest')
            ->post('/api/admin/media', ['file' => UploadedFile::fake()->image('photo.png', 40, 40)], ['Content-Type' => 'multipart/form-data'])
            ->assertCreated();
    }

    public function test_non_admin_cannot_reach_the_media_library(): void
    {
        Storage::fake('public');
        $user = User::factory()->create(['phone' => '09'.fake()->unique()->numerify('#########'), 'is_active' => true]);

        $this->actingAs($user)
            ->postJson('/api/admin/media', [])
            ->assertForbidden();
    }
}
